// The conference room's playback: what the room shows, paced, however fast the meeting's updates come. Claude can
// send a whole meeting (gathering, the turns, the wrap-up, the end) in a few seconds; the transcript shows each line at
// once, but the room plays it at a person's pace: the attendees walk in and sit (a walk is waited for, up to WALK_MAX
// seconds), each turn's bubble stays up long enough to read (TURN_BASE + TURN_CHAR a character, at most TURN_MAX, a
// page at a time), the decisions stay on the screen, and only then do they walk out.
//
// Every update is turned into items (a new meeting, a change of state, one turn, an end), queued in order and never
// dropped. A new meeting waits for the one before to finish playing. More than BACKLOG items behind, the room skips
// ahead to the newest state and sums up quickly (the decisions on the screen for SUMMARY seconds). A page opened (or
// reloaded) mid-meeting jumps straight to the current state instead of playing it from the start.
//
// Pure: no page, no timers. conference.js pushes each meeting as it reads it (checked already) and ticks it with a
// clock and two questions for the engine (is everyone seated? is this one?). Loaded by the page as a plain script
// (it sets window.__aoMeetPlay), and by the tests.
(function (root) {
  'use strict'
  const TIMING = {
    WALK_MIN: 0.4,      // the engine hears about the walk on the next frame: never "seated" before this
    WALK_MAX: 25,       // seconds a walk to the table is waited for, at most
    SIT: 0.8,           // a beat once they are seated
    STATE_MIN: 1.5,     // a new state on the screen ("NOW PRESENTING") before the next turn
    SPEAKER_WAIT: 6,    // a turn waits this long at most for its speaker to sit down
    TURN_BASE: 2.5,     // a bubble page: TURN_BASE + TURN_CHAR a character, at most TURN_MAX
    TURN_CHAR: 0.05,
    TURN_MAX: 9,
    GAP: 0.7,           // a breath between turns
    LINGER_MIN: 4,      // an ended meeting stays seated with its decisions on the screen: LINGER_MIN, plus LINGER_PER a
    LINGER_PER: 1.5,    //   decision, at most LINGER_MAX
    LINGER_MAX: 9,
    EXIT: 2.5,          // they walk out: the next meeting waits this long
    PAGED: 8,           // more turns than this waiting: each turn's first page only (the rest is in the transcript)
    BACKLOG: 20,        // more items than this waiting: skip ahead to the newest state
    SUMMARY: 3,         // after a skip, the newest state (the decisions) for this long
    FRESH_MS: 45000,    // a page opened mid-meeting still plays a turn this new
  }
  const PAGE_WORDS = 15
  const PAGE_CHARS = 125
  const GOING = ['gathering', 'in_session', 'discussion', 'wrap_up']
  const RANK = { scheduled: 0, gathering: 1, in_session: 2, discussion: 3, wrap_up: 4, ended: 5 }
  const KIND_STATUS = { proposal: 'in_session', reply: 'discussion', question: 'discussion', decision: 'wrap_up' }
  const DECISIONS_MAX = 8

  // a bubble page: about fifteen words, ending where a sentence does when it can, never over 125 characters
  function pagesOf(text) {
    const flat = String(text).replace(/\s+/g, ' ').trim()
    const sentences = flat.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [flat]
    const pages = []
    let cur = []
    const len = ws => ws.join(' ').length
    for (const s0 of sentences) {
      const sw = s0.trim().split(' ').filter(Boolean)
      if (cur.length && (cur.length + sw.length > PAGE_WORDS + 4 || len(cur) + len(sw) > PAGE_CHARS)) {
        pages.push(cur.join(' '))
        cur = []
      }
      for (const w of sw) {
        if (cur.length >= PAGE_WORDS + 4 || (cur.length && len(cur) + w.length > PAGE_CHARS)) {
          pages.push(cur.join(' '))
          cur = []
        }
        cur.push(w)
      }
    }
    if (cur.length) pages.push(cur.join(' '))
    return pages.length ? pages : ['…']
  }

  const statusOf = m => (m ? (m.live ? m.status : 'ended') : 'ended')
  const isGoing = s => GOING.includes(s)
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const FIELDS = ['title', 'topic', 'agenda', 'people']

  function create(options) {
    const T = Object.assign({}, TIMING, options || {})
    const pageSecs = p => Math.min(T.TURN_MAX, T.TURN_BASE + T.TURN_CHAR * p.length)
    let last = null           // the newest meeting pushed
    let heard = new Set()     // its turn numbers already queued (or played)
    const q = []              // items waiting to play, oldest first
    let step = null           // the item playing: { phases, i }
    let view = null           // the room: { id, title, topic, status, agenda, people, decisions }; null is no meeting
    let inRoom = false        // whether the attendees are (or are walking) in the room
    let played = new Set()    // turn numbers the room has played (or let go)
    let turn = null           // the turn on the floor: { turn, pages, i, speaking }
    let instant = false       // the room jumped: the engine seats everyone without a walk (taken once)

    function base(m) {
      return { id: m.id, title: m.title, topic: m.topic, status: 'scheduled', agenda: m.agenda, people: m.people, decisions: [] }
    }
    // the screen's state moves forward with the turns (a proposal is presented in session, a decision is the
    // wrap-up), never back, and never past the state the turn arrived with
    function bump(s, cap) {
      if (view && RANK[s] > RANK[view.status] && RANK[s] <= RANK[cap || 'ended']) view.status = s
    }
    function decide(t) {
      if (view && t.kind === 'decision') view.decisions = view.decisions.concat(t.text).slice(-DECISIONS_MAX)
    }

    // -- an update becomes items: the fields first (the people must be in the room before they speak), a new state
    // before the turns it introduces (or after them, when it comes after: discussion after the last proposal), the
    // turns in order, the end last
    function push(m, opt) {
      if (opt && opt.jump) return jump(m, opt.wall)
      const prev = last
      last = m || null
      if (!m) {
        if (prev && statusOf(prev) !== 'ended') q.push({ k: 'end' })
        if (prev) q.push({ k: 'clear' })
        heard = new Set()
        return trim()
      }
      const fresh = !prev || prev.id !== m.id
      if (fresh) {
        if (prev && statusOf(prev) !== 'ended') q.push({ k: 'end' })
        q.push({ k: 'open', m: base(m) })
        heard = new Set()
      }
      const fields = {}
      for (const f of FIELDS) if (fresh || !same(prev[f], m[f])) fields[f] = m[f]
      const before = fresh ? 'scheduled' : statusOf(prev)
      const status = statusOf(m)
      const turns = m.turns.filter(t => !heard.has(t.n))
      for (const t of turns) heard.add(t.n)
      if (Object.keys(fields).length) q.push({ k: 'state', fields })
      const items = turns.map(t => ({ k: 'turn', t, cap: status }))
      if (status !== before) {
        const st = { k: 'state', fields: {}, status }
        if (status === 'ended') items.push(st)
        else {
          const at = items.findIndex(x => KIND_STATUS[x.t.kind] && RANK[KIND_STATUS[x.t.kind]] >= RANK[status])
          items.splice(at < 0 ? (RANK[status] <= RANK.in_session ? 0 : items.length) : at, 0, st)
        }
      }
      q.push(...items)
      trim()
    }

    // a reload (or the page's first read): the room is the meeting as it stands now, no walk; only a turn said in the
    // last few seconds still plays
    function jump(m, wall) {
      q.length = 0
      step = null
      turn = null
      last = m || null
      heard = new Set(m ? m.turns.map(t => t.n) : [])
      played = new Set(heard)
      if (!m) {
        view = null
        inRoom = false
        instant = true
        return
      }
      view = base(m)
      view.status = statusOf(m)
      view.decisions = m.turns.filter(t => t.kind === 'decision').map(t => t.text).slice(-DECISIONS_MAX)
      inRoom = isGoing(view.status)
      instant = true
      const newest = m.turns[m.turns.length - 1]
      const now = typeof wall === 'number' ? wall : Date.now()
      if (newest && inRoom && now - newest.at < T.FRESH_MS) {
        played.delete(newest.n)
        if (newest.kind === 'decision') view.decisions = view.decisions.slice(0, -1)
        q.push({ k: 'turn', t: newest, cap: view.status })
      }
    }

    // too far behind: everything waiting applies at once, then the newest state shows for a moment
    function trim() {
      if (q.length <= T.BACKLOG) return
      if (step && step.item) finish(step.item)
      step = null
      turn = null
      const items = q.splice(0)
      for (const it of items) apply(it)
      if (!view) return
      if (view.status === 'ended') {             // the decisions on the screen a moment, those seated get up after
        step = { phases: [hold(T.SUMMARY), { dur: 0, start: () => { inRoom = false } }, hold(inRoom ? T.EXIT : 0)], i: 0 }
      } else {
        if (isGoing(view.status)) inRoom = true
        step = { phases: [hold(T.SUMMARY)], i: 0 }
      }
    }
    // an item's effect on the room, without its time (a skip)
    function apply(it) {
      if (it.k === 'open') {
        view = it.m
        played = new Set()
      } else if (it.k === 'clear') {
        view = null
        inRoom = false
      } else if (it.k === 'end') {
        if (view) view.status = 'ended'
      } else if (it.k === 'state' && view) {
        Object.assign(view, it.fields)
        if (it.status) view.status = it.status
      } else if (it.k === 'turn' && view) {
        played.add(it.t.n)
        bump(KIND_STATUS[it.t.kind] || view.status, it.cap)
        decide(it.t)
      }
    }
    function finish(it) {                       // the rest of an item cut short by a skip
      if (it.k === 'turn' && view) {
        played.add(it.t.n)
        if (!view.decisions.length || view.decisions[view.decisions.length - 1] !== it.t.text) decide(it.t)
      }
    }

    // -- the phases an item plays: a hold (a time), or a wait (for the engine, with a cap)
    const hold = dur => ({ dur })
    const walkIn = () => [
      { dur: 0, start: () => { inRoom = true; bump('gathering') } },
      { wait: 'ready', min: T.WALK_MIN, max: T.WALK_MAX },
      hold(T.SIT),
    ]
    const close = () => [
      { dur: 0, start: () => { if (view) view.status = 'ended' } },
      { dur: 0, linger: true },
      { dur: 0, start: () => { inRoom = false } },
      hold(T.EXIT),
    ]
    function begin(it) {
      const phases = []
      if (it.k === 'open') {
        phases.push({ dur: 0, start: () => { apply(it); inRoom = false } })
      } else if (it.k === 'clear') {
        phases.push({ dur: 0, start: () => apply(it) })
      } else if (it.k === 'end') {
        if (view && view.status !== 'ended') phases.push(...close())
        else phases.push({ dur: 0, start: () => { inRoom = false } })
      } else if (it.k === 'state') {
        const s = it.status
        const joined = it.fields.people && view && inRoom && !same(it.fields.people.map(p => p.id).sort(),
          view.people.map(p => p.id).sort())
        phases.push({ dur: 0, start: () => {
          if (!view) return
          Object.assign(view, it.fields)
          if (s && s !== 'ended') view.status = s
        } })
        if (s === 'ended') phases.push(...(inRoom ? close() : [{ dur: 0, start: () => { if (view) view.status = 'ended' } }]))
        else if (s && isGoing(s) && !inRoom) phases.push(...walkIn())
        else if (joined) phases.push({ wait: 'ready', min: T.WALK_MIN, max: T.WALK_MAX })
        else if (s && isGoing(s)) phases.push(hold(T.STATE_MIN))
      } else if (it.k === 'turn') {
        if (!view) return { phases: [], i: 0, item: it }
        if (!inRoom) phases.push(...walkIn())
        const pages = pagesOf(it.t.text)
        const busy = q.filter(x => x.k === 'turn').length > T.PAGED
        const shown = busy ? pages.slice(0, 1) : pages
        phases.push({ dur: 0, start: () => {
          played.add(it.t.n)
          bump(KIND_STATUS[it.t.kind] || view.status, it.cap)
          turn = { turn: it.t, pages: shown, i: 0, speaking: false }
        } })
        phases.push({ wait: 'seated', id: it.t.speaker, min: 0, max: T.SPEAKER_WAIT })
        shown.forEach((p, i) => phases.push({ dur: pageSecs(p), start: () => {
          if (!turn) return
          turn.i = i
          turn.speaking = true
          if (i === 0) decide(it.t)
        } }))
        phases.push({ dur: 0, start: () => { turn = null } }, hold(T.GAP))
      }
      return { phases, i: 0, item: it }
    }
    // a phase is done: its time is up, or what it waits for happened (or its cap came)
    function run(s, now, room) {
      while (s.i < s.phases.length) {
        const p = s.phases[s.i]
        if (p.at === undefined) {
          p.at = now
          if (p.linger) p.dur = Math.min(T.LINGER_MAX, Math.max(T.LINGER_MIN, T.LINGER_PER * (view ? view.decisions.length : 0) + 2))
          if (p.start) p.start()
        }
        const t = now - p.at
        let done
        if (p.wait === 'ready') done = (t >= p.min && !!(room && room.ready && room.ready())) || t >= p.max
        else if (p.wait === 'seated') done = (t >= p.min && !!(room && room.seated && room.seated(p.id))) || t >= p.max
        else done = t >= p.dur
        if (!done) return false
        s.i++
      }
      return true
    }
    /** Moves the room on to `now` (seconds, any clock that only goes forward). room: { ready(), seated(id) }. */
    function tick(now, room) {
      for (let guard = 0; guard < 200; guard++) {
        if (step) {
          if (!run(step, now, room)) break
          step = null
          continue
        }
        if (!q.length) break
        step = begin(q.shift())
      }
      return state()
    }
    function state() {
      return { view, inRoom, turn, played, queued: q.length, busy: !!step || q.length > 0 }
    }
    return {
      push,
      tick,
      state,
      /** Whether the engine should seat everyone without a walk (once, after a jump). */
      takeInstant() { const i = instant; instant = false; return i },
    }
  }

  const api = { create, pagesOf, TIMING }
  root.__aoMeetPlay = api
})(typeof window !== 'undefined' ? window : globalThis)
