// The conference room: the meetings you watch. It reads the meeting the plugin writes (meeting.js) when the live list
// says its version moved (through the bridge by fetch, which a 304 answers while it is unchanged, parsed as JSON,
// never run; from a file by a script tag), and then:
//   - plays the meeting in the room at a person's pace, however fast the updates come (meetplay.js keeps the queue
//     and the timing): the attendees walk in and sit, each turn shows in a speech bubble by the speaker long enough to
//     read, the decisions stay on the screen, then they walk out; it tells the engine who attends, in which chair, and
//     who has the floor; a page opened mid-meeting jumps to where the meeting is;
//   - writes the screen at the head of the table: the proposal being presented and the agenda; the decisions after;
//     "Call a meeting" while none is on;
//   - keeps the transcript in a Meeting tab at the front desk, with a dot for lines not yet seen;
//   - lets you call a meeting (an optional topic) and speak in one (the front desk's "Say in meeting").
// Every word from the meeting is model-written: it is only ever set as text (textContent), never parsed as HTML. Its
// style is in office.css (the page's CSP allows no other).
(function () {
  'use strict'
  const CFG = window.__aoCfg
  const svg = document.getElementById('nr')
  const desk = document.getElementById('fd-desk')
  if (!CFG || !svg || !CFG.conf) return
  const C = CFG.conf
  const NS = 'http://www.w3.org/2000/svg'
  const KEY = new URLSearchParams(location.search).get('k') || ''
  const LIVE = /^https?:$/.test(location.protocol)
  const CAN_SEND = LIVE && /^[\w-]{40,}$/.test(KEY)
  const q = KEY ? `k=${encodeURIComponent(KEY)}&` : ''
  const FONT = "Consolas, 'Courier New', monospace"
  const office = () => window.__aoOffice
  const body = document.body
  const get = k => { try { return localStorage.getItem(k) || '' } catch (e) { return '' } }
  const put = (k, v) => { try { localStorage.setItem(k, v) } catch (e) { /* private window */ } }
  const mk = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag)
    for (const k in attrs) e.setAttribute(k, attrs[k])
    if (parent) parent.appendChild(e)
    return e
  }
  const el = (tag, cls, parent, text) => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text !== undefined) e.textContent = text
    if (parent) parent.appendChild(e)
    return e
  }
  const isBox = (a, n) => Array.isArray(a) && a.length === n && a.every(v => typeof v === 'number' && Number.isFinite(v))
  if (!isBox(C.screen, 4) || !isBox(C.call, 4) || !Array.isArray(C.seats) || !window.__aoMeetPlay) return
  const player = window.__aoMeetPlay.create()
  const LIGHTS_OFF = 18              // seconds after the last of them leaves, the room goes dark

  // -- checking meeting.js: the plugin checked it already; this checks again, field by field, before anything is used
  const STATUSES = ['scheduled', 'gathering', 'in_session', 'discussion', 'wrap_up', 'ended']
  const TURNS = ['proposal', 'reply', 'question', 'decision', 'note']
  const SEATS = ['claude', 'owner', 'crew', 'agent']
  const ID = /^[a-z0-9_-]{1,24}$/
  const COLOR = /^#[0-9a-f]{6}$/i
  const DESK = /^d\d$/
  const CREW = /^s\d{1,2}$/
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '')
  const label = v => str(v, 16).replace(/[\u0000-\u001f\u007f]/g, '')
  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  function clean(d) {
    if (!d || typeof d !== 'object' || !ID.test(d.id)) return null
    const people = []
    for (const a of (Array.isArray(d.attendees) ? d.attendees : []).slice(0, 12)) {
      if (!a || !ID.test(a.id) || people.some(p => p.id === a.id)) continue
      people.push({ id: a.id, name: str(a.name, 24) || a.id, role: str(a.role, 40), label: label(a.label),
        color: COLOR.test(a.color) ? a.color : '#a78bfa', kind: SEATS.includes(a.kind) ? a.kind : 'agent',
        seat: Number.isInteger(a.seat) && a.seat >= 0 && a.seat < C.seats.length ? a.seat : -1,
        desk: DESK.test(a.desk) ? a.desk : 'd0', crew: CREW.test(a.crew) ? a.crew : '' })
    }
    const turns = []
    for (const t of (Array.isArray(d.turns) ? d.turns : []).slice(-200)) {
      if (!t || !Number.isInteger(t.n) || !ID.test(t.speaker_id) || typeof t.text !== 'string') continue
      turns.push({ n: t.n, speaker: t.speaker_id, kind: TURNS.includes(t.kind) ? t.kind : 'note', text: str(t.text, 600),
        title: str(t.title, 120), at: num(t.at) })
    }
    const agenda = (Array.isArray(d.agenda) ? d.agenda : []).slice(0, 8).filter(x => x && typeof x.title === 'string')
      .map(x => ({ title: str(x.title, 120), label: label(x.label), color: COLOR.test(x.color) ? x.color : '#a78bfa' }))
    const decisions = (Array.isArray(d.decisions) ? d.decisions : []).filter(x => typeof x === 'string').slice(-8).map(x => x.slice(0, 600))
    return { id: d.id, title: str(d.title, 120) || 'Meeting', topic: str(d.topic, 120),
      status: STATUSES.includes(d.status) ? d.status : 'scheduled', live: d.live === true, people, turns, agenda, decisions }
  }
  const GOING = ['gathering', 'in_session', 'discussion', 'wrap_up']
  const CHIP = { scheduled: 'CALLED', gathering: 'GATHERING', in_session: 'IN SESSION', discussion: 'DISCUSSION', wrap_up: 'WRAP-UP',
    ended: 'ENDED' }
  const KIND_WORD = { proposal: 'PROPOSAL', reply: 'REPLY', question: 'QUESTION', decision: 'DECISION', note: 'NOTE' }
  // a color lightened for a name on the dark panel, darkened for one on the white bubble
  const mix = (c, to, f) => '#' + [1, 3, 5].map(i => {
    const a = parseInt(c.slice(i, i + 2), 16)
    const b = parseInt(to.slice(i, i + 2), 16)
    return Math.round(a + (b - a) * f).toString(16).padStart(2, '0')
  }).join('')
  const onDark = c => mix(c, '#ffffff', 0.42)
  const onLight = c => mix(c, '#1a0f26', 0.35)

  let M = null                       // the meeting, checked, as it stands now: the panel and the transcript show it
  let R = null                       // the meeting as the room is playing it (meetplay.js): the room and the screen
  let inRoom = false                 // whether the attendees are (or are walking) in the room
  let cur = null                     // the turn on the floor: { turn, pages, i, speaking }
  let played = new Set()             // turn numbers the room has played
  let busy = false                   // the room is still playing (or about to)
  let first = true                   // the first read of this page
  const going = () => !!(M && M.live && GOING.includes(M.status))
  const live = () => !!(M && M.live)
  const who = id => (R ? R.people.find(p => p.id === id) : null) || (M ? M.people.find(p => p.id === id) : null) ||
    { id, name: id, label: '', color: '#a78bfa' }

  // -- the panel: the meeting's title and state, the agenda, the transcript; calling one, or speaking in it
  const panel = el('section', 'meet')
  panel.id = 'nr-meet'
  panel.setAttribute('aria-label', 'Meeting')
  const head = el('header', 'mt-head', panel)
  const top = el('div', 'mt-top', head)
  const titleEl = el('h3', 'mt-title', top, 'Conference room')
  const chip = el('span', 'mt-chip', top)
  const chipDot = el('i', 'live-dot', chip)
  const chipWord = el('span', '', chip, 'NO MEETING')
  const sub = el('div', 'mt-sub', head)
  const agendaEl = el('ol', 'mt-agenda', head)
  const logEl = el('ol', 'mt-log', panel)
  logEl.setAttribute('aria-live', 'polite')
  const emptyEl = el('p', 'mt-empty', panel, '')
  const foot = el('div', 'mt-foot', panel)
  const callForm = el('form', 'mt-call', foot)
  const topic = el('input', '', callForm)
  topic.type = 'text'
  topic.id = 'mt-topic'
  topic.maxLength = 120
  topic.autocomplete = 'off'
  topic.placeholder = 'Topic (optional)'
  topic.setAttribute('aria-label', 'Meeting topic (optional)')
  const callBtn = el('button', 'mt-btn', callForm, 'Call a meeting')
  callBtn.type = 'submit'
  const msg = el('p', 'mt-msg', foot, '')
  if (!CAN_SEND) foot.hidden = true
  const fdLog = document.getElementById('fd-log')
  const fdJump = document.getElementById('fd-jump')
  if (desk) (fdJump || fdLog || desk.lastChild).after(panel)

  // -- the tabs: Chat and Meeting, at the top of the front desk
  const tabs = el('div', 'fd-tabs')
  tabs.setAttribute('role', 'tablist')
  const tabChat = el('button', 'fd-tab', tabs, 'Chat')
  const tabMeet = el('button', 'fd-tab', tabs)
  el('span', '', tabMeet, 'Meeting')
  const tabLive = el('i', 'live-dot', tabMeet)
  const tabDot = el('i', 'udot', tabMeet)
  for (const t of [tabChat, tabMeet]) {
    t.type = 'button'
    t.setAttribute('role', 'tab')
  }
  const fdHead = desk && desk.querySelector('.fd-head')
  if (fdHead) fdHead.after(tabs)
  function tab(which, remember) {
    const meet = which === 'meet'
    if (desk) desk.classList.toggle('tab-meet', meet)
    tabChat.setAttribute('aria-selected', meet ? 'false' : 'true')
    tabMeet.setAttribute('aria-selected', meet ? 'true' : 'false')
    if (remember) put('ao-tab', meet ? 'meet' : 'chat')
    if (window.__aoMeetSay) window.__aoMeetSay.set(meet && going())
    if (meet) {
      seen()
      requestAnimationFrame(() => { logEl.scrollTop = logEl.scrollHeight })
    }
  }
  tabChat.addEventListener('click', () => tab('chat', true))
  tabMeet.addEventListener('click', () => tab('meet', true))
  tab(get('ao-tab') === 'meet' ? 'meet' : 'chat', false)

  // -- unread: turns that came in while the transcript wasn't in view (kept a meeting at a time)
  let seenN = 0
  const newest = () => (M && M.turns.length ? M.turns[M.turns.length - 1].n : 0)
  const inView = () => !!(desk && desk.classList.contains('tab-meet') && !body.classList.contains('desk-closed'))
  function seen() {
    if (!M) return
    seenN = newest()
    put('ao-meet-seen', `${M.id}:${seenN}`)
    dots()
  }
  function dots() {
    tabDot.hidden = !(M && newest() > seenN && !inView())
    tabLive.hidden = !going()
  }
  new MutationObserver(() => { if (inView()) seen() }).observe(body, { attributes: true, attributeFilter: ['class'] })

  // -- the transcript
  const shown = new Map()            // turn n -> li
  const time = ms => {
    try { return ms ? new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '' } catch (e) { return '' }
  }
  function line(t) {
    const p = who(t.speaker)
    const li = el('li', `mt-line k-${t.kind}`)
    li.dataset.n = String(t.n)
    const w = el('div', 'mt-who', li)
    const dot = el('i', '', w)
    dot.style.background = p.color
    const name = el('b', '', w, p.name)
    name.style.color = onDark(p.color)
    if (p.label && p.label !== p.name.toUpperCase()) el('span', 'dept', w, p.label)
    if (t.kind !== 'reply' && t.kind !== 'note') el('span', 'kind', w, KIND_WORD[t.kind])
    el('time', '', w, time(t.at))
    const tx = el('p', 'mt-text', li)
    if (t.title) el('strong', '', tx, t.title)
    tx.append(document.createTextNode(t.text))
    return li
  }
  function transcript() {
    const near = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 80
    const turns = M ? M.turns : []
    const keep = new Set(turns.map(t => t.n))
    for (const [n, li] of shown) if (!keep.has(n)) { li.remove(); shown.delete(n) }
    let prev = null
    for (const t of turns) {
      let li = shown.get(t.n)
      if (!li) {
        li = line(t)
        shown.set(t.n, li)
      }
      const want = prev ? prev.nextSibling : logEl.firstChild
      if (li !== want) logEl.insertBefore(li, want)
      prev = li
    }
    if (near || first) logEl.scrollTop = logEl.scrollHeight
  }
  function speaking(n) {
    for (const [k, li] of shown) li.classList.toggle('now', k === n)
  }

  // -- the head of the panel: the title, the state, a line of counts, the agenda with the one being presented
  function agendaNow() {              // from the room: the proposal it has reached
    if (!R || !R.agenda.length || !M || M.id !== R.id) return -1
    const props = M.turns.filter(t => t.kind === 'proposal' && (played.has(t.n) || (cur && cur.turn.n === t.n)))
    const last = cur && cur.turn.kind === 'proposal' ? cur.turn : props[props.length - 1]
    if (!last) return -1
    const ti = (last.title || '').toLowerCase()
    const byTitle = R.agenda.findIndex(a => a.title.toLowerCase() === ti)
    if (byTitle >= 0) return byTitle
    const lab = who(last.speaker).label
    const byDept = R.agenda.findIndex(a => a.label && a.label === lab)
    return byDept >= 0 ? byDept : Math.min(R.agenda.length - 1, props.length - 1)
  }
  let headSig = ''
  function header() {
    const now = agendaNow()
    const hs = JSON.stringify([M && M.id, M && M.title, M && M.status, M && M.live, M && M.turns.length, M && M.people.length,
      M && M.agenda.length, now, going(), CAN_SEND, M && R && M.id === R.id && R.status])
    if (hs === headSig) return
    headSig = hs
    titleEl.textContent = M ? M.title : 'Conference room'
    chipWord.textContent = M ? (M.live ? CHIP[M.status] : 'ENDED') : 'NO MEETING'
    chip.classList.toggle('on', going())
    chipDot.hidden = !going()
    const n = M ? M.turns.length : 0
    const d = M ? M.turns.filter(t => t.kind === 'decision').length : 0
    sub.textContent = M ? [`${M.people.length} attending`, `${n} turn${n === 1 ? '' : 's'}`, `${d} decision${d === 1 ? '' : 's'}`].join(' · ') : ''
    sub.hidden = !M
    const roomOn = !!(R && M && R.id === M.id && GOING.includes(R.status))     // the room is still playing it
    agendaEl.replaceChildren(...(M ? M.agenda : []).map((a, i) => {
      const li = el('li', 'mt-ag' + (i === now && roomOn ? ' now' : i < now || (!roomOn && M.status === 'ended') ? ' done' : ''))
      const dot = el('i', '', li)
      dot.style.background = a.color
      el('b', '', li, a.label)
      el('span', '', li, a.title)
      el('em', '', li, i === now && roomOn ? '●' : i < now || (!roomOn && M && M.status === 'ended') ? '✓' : '')
      return li
    }))
    agendaEl.hidden = !(M && M.agenda.length)
    emptyEl.hidden = !!(M && M.turns.length)
    emptyEl.textContent = !M ? 'No meeting yet. Call one: each department brings a proposal, they talk it through, and the decisions land here.'
      : M.status === 'scheduled' ? 'Called. Claude is gathering the departments.' : M.turns.length ? '' : 'Taking their seats.'
    callForm.hidden = live()
    callBtn.disabled = live()
  }

  // -- the screen at the head of the table: drawn into the page's group, text only ever set as text
  const screen = document.getElementById('nr-p-conf')
  const [, , SW, SH] = C.screen
  let plate = false                  // whether "Call a meeting" is on the screen (and so takes a click)
  const fit = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
  function wrapText(s, n, max) {
    const out = []
    let cur0 = ''
    for (const w of String(s).split(/\s+/).filter(Boolean)) {
      if (!cur0) cur0 = w.slice(0, n)
      else if (cur0.length + 1 + w.length <= n) cur0 += ' ' + w
      else {
        out.push(cur0)
        cur0 = w.slice(0, n)
      }
    }
    if (cur0) out.push(cur0)
    if (out.length > max) {
      out.length = max
      out[max - 1] = fit(out[max - 1] + '…', n)
    }
    return out
  }
  let screenSig = ''
  function drawScreen() {
    if (!screen) return
    const now = agendaNow()
    const prop = cur && cur.turn.kind === 'proposal' && cur.turn.title ? cur.turn.title : now >= 0 && R ? R.agenda[now].title : ''
    const state = !R ? 'none' : R.status
    const sig = JSON.stringify([state, R && R.title, prop, now, R && R.decisions, R && R.agenda.length, live()])
    if (sig === screenSig) return
    screenSig = sig
    for (const c of [...screen.childNodes]) if (c.nodeName !== 'clipPath') c.remove()
    const g = mk('g', { 'clip-path': 'url(#nr-clip-conf)' }, screen)
    const t = (x, y, s, c, text, anchor, bold) => {
      const e = mk('text', { x, y, 'font-size': s, 'font-family': FONT, fill: c }, g)
      if (anchor) e.setAttribute('text-anchor', anchor)
      if (bold) e.setAttribute('font-weight', 'bold')
      e.textContent = text
      return e
    }
    plate = false
    if (state === 'none' || state === 'ended') {
      const ds = R ? R.decisions : []
      if (ds.length) {
        t(2, 4.4, 2.5, '#5ef08a', 'DECISIONS', '', 1)
        t(SW - 2, 4.4, 2.3, '#8f86b3', String(ds.length), 'end', 1)
        mk('rect', { x: 2, y: 5.6, width: SW - 4, height: 0.4, fill: '#2f3a63' }, g)
        ds.slice(-2).forEach((d, i) => {
          mk('rect', { x: 2, y: 7.6 + i * 3.6, width: 1.4, height: 1.4, fill: '#5ef08a' }, g)
          t(4.6, 9 + i * 3.6, 2.2, '#e8e4f8', fit(d, 31))
        })
      } else {
        t(SW / 2, 6, 3, '#c4b5fd', 'CONFERENCE', 'middle', 1)
        t(SW / 2, 11, 2.4, '#8f86b3', R ? 'NO MEETING ON' : 'NO MEETING YET', 'middle')
      }
      if (CAN_SEND && !live()) {
        plate = true
        const [x0, y0, x1, y1] = C.call
        const px = x0 - C.screen[0]
        const py = y0 - C.screen[1]
        mk('rect', { x: px, y: py, width: x1 - x0, height: y1 - y0, fill: '#a78bfa' }, g)
        mk('rect', { x: px, y: py + (y1 - y0) - 0.8, width: x1 - x0, height: 0.8, fill: '#7c5fd6' }, g)
        t(px + (x1 - x0) / 2, py + 3.6, 2.6, '#1a0f2e', 'CALL A MEETING', 'middle', 1)
      }
      return
    }
    if (state === 'scheduled') {
      t(SW / 2, 4.6, 2.5, '#fbbf24', 'MEETING CALLED', 'middle', 1)
      wrapText(R.title, 23, 2).forEach((l, i) => t(SW / 2, 10 + i * 3.8, 3, '#f3efff', l, 'middle', 1))
      t(SW / 2, 18.6, 2.2, '#8f86b3', 'GATHERING SOON', 'middle')
      return
    }
    const word = { gathering: 'TAKING SEATS', in_session: 'NOW PRESENTING', discussion: 'DISCUSSION', wrap_up: 'WRAP-UP' }[state] || ''
    t(2, 4.2, 2.3, state === 'wrap_up' ? '#5ef08a' : '#fbbf24', word, '', 1)
    if (R.agenda.length) t(SW - 2, 4.2, 2.3, '#8f86b3', `${Math.max(0, now) + 1}/${R.agenda.length}`, 'end', 1)
    mk('rect', { x: 2, y: 5.4, width: SW - 4, height: 0.4, fill: '#2f3a63' }, g)
    if (state === 'wrap_up' && R.decisions.length) {
      R.decisions.slice(-3).forEach((d, i) => {
        mk('rect', { x: 2, y: 7.4 + i * 3.7, width: 1.4, height: 1.4, fill: '#5ef08a' }, g)
        t(4.6, 8.8 + i * 3.7, 2.2, '#e8e4f8', fit(d, 31))
      })
      return
    }
    wrapText(prop || R.title, 23, 2).forEach((l, i) => t(2, 9.4 + i * 3.6, 3, '#ffffff', l, '', 1))
    const from = Math.max(0, Math.min(now, R.agenda.length - 1))
    R.agenda.slice(from, from + 1).forEach((a, k) => {
      const i = from + k
      const y = 17.6
      mk('rect', { x: 2, y: y - 1.6, width: 1.6, height: 1.6, fill: a.color }, g)
      t(4.8, y, 2.2, i === now ? '#ffffff' : '#b8b0d8', fit(a.title, 30), '', i === now ? 1 : 0)
    })
  }

  // -- playback: meetplay.js turns each read into items and plays them at a person's pace; this asks the engine
  // whether they have sat down, and hands the room on to the engine, the screen and the bubble. Its clock runs only
  // while the page is in view (the walks stop when it is hidden), so a meeting held meanwhile plays on your return.
  let offAt = 0                      // when the lights go down, once they have left
  let playClock = 0
  let lastTick = performance.now() / 1000
  const roomIO = {
    ready: () => { const o = office(); return !o || !o.meetReady || o.meetReady() },
    seated: id => {
      const o = office()
      const p = R && R.people.find(x => x.id === id)
      if (!o || !o.meetPos || !p || p.seat < 0) return true          // no chair: nothing to wait for
      return !!o.meetPos(id)
    },
  }
  function step() {
    const t = performance.now() / 1000
    const dt = Math.min(1, Math.max(0, t - lastTick))
    lastTick = t
    if (!document.hidden) playClock += dt
    const was = inRoom
    const s = player.tick(playClock, roomIO)
    R = s.view
    inRoom = s.inRoom
    cur = s.turn
    played = s.played
    busy = s.busy
    if (player.takeInstant()) engine(true)
    else engineSpeaker()
    if (was && !inRoom) offAt = t + LIGHTS_OFF
    if (inRoom || (offAt && t >= offAt)) offAt = 0
    speaking(cur && cur.speaking ? cur.turn.n : -1)
    lights()
    drawScreen()
    header()
    bubble()
  }

  // -- the engine: who is in the room, and who has the floor
  let sentSig = ''
  const speakerNow = () => (cur && cur.speaking ? cur.turn.speaker : null)
  const sig = () => JSON.stringify([inRoom, R && R.people.map(p => [p.id, p.seat, p.kind]), speakerNow()])
  function engine(instant) {
    const o = office()
    if (!o || !o.meet) return
    o.meet({ on: inRoom && !!R, attendees: (R ? R.people : []).filter(p => p.seat >= 0).map(p => ({ id: p.id, kind: p.kind,
      seat: p.seat, desk: p.desk, crew: p.crew, color: p.color })), speaker: speakerNow() }, !!instant)
    sentSig = sig()
  }
  function engineSpeaker() { if (sig() !== sentSig) engine(false) }
  function lights() {
    const v = live() || inRoom || offAt || busy || (R && R.status !== 'ended') ? 'on' : 'off'
    if (svg.getAttribute('data-meet') !== v) svg.setAttribute('data-meet', v)
  }

  // -- the bubble: over the speaker's head (under their feet when there is no room above); in real type, so it
  // reads at any size
  const bub = el('div', 'mt-bub')
  bub.hidden = true
  bub.setAttribute('aria-hidden', 'true')       // the transcript is what a screen reader reads
  const bw = el('div', 'mt-bub-who', bub)
  const bdot = el('i', '', bw)
  const bname = el('b', '', bw)
  const bdept = el('span', '', bw)
  const bpage = el('em', '', bw)
  const btext = el('p', '', bub)
  document.body.appendChild(bub)
  let bubSig = ''
  function where(ax, ay) {                      // an art point on the screen
    const r = svg.getBoundingClientRect()
    if (!r.width || !r.height) return null
    const vb = svg.viewBox.baseVal
    const px = ax * 2
    const py = ay * 2
    if (px < vb.x || px > vb.x + vb.width || py < vb.y || py > vb.y + vb.height) return null
    return { x: r.left + (px - vb.x) / vb.width * r.width, y: r.top + (py - vb.y) / vb.height * r.height, r }
  }
  function bubble() {
    const pos = cur && cur.speaking && office() && office().meetPos ? office().meetPos(cur.turn.speaker) : null
    const head0 = pos && !document.hidden ? where(pos.x, pos.y) : null
    if (!head0) {
      if (!bub.hidden) bub.hidden = true
      bubSig = ''
      return
    }
    const p = who(cur.turn.speaker)
    const s = `${cur.turn.n}|${cur.i}`
    if (s !== bubSig) {
      bubSig = s
      bdot.style.background = p.color
      bname.textContent = p.name
      bname.style.color = onLight(p.color)
      bdept.textContent = p.label && p.label !== p.name.toUpperCase() ? p.label : ''
      bpage.textContent = cur.pages.length > 1 ? `${cur.i + 1}/${cur.pages.length}` : ''
      btext.textContent = cur.pages[cur.i] || ''
    }
    bub.hidden = false
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight
    const w = bub.offsetWidth
    const h = bub.offsetHeight
    const feet = where(pos.x, pos.feet) || head0
    const lo = Math.max(6, head0.r.left + 4)
    const hi = Math.min(vw - 6, head0.r.right - 4)
    const left = Math.max(6, Math.round(Math.max(lo, Math.min(hi - w, head0.x - w / 2))))
    let topY = Math.round(head0.y - h - 12)
    const below = topY < Math.max(4, head0.r.top - h * 0.6)
    if (below) topY = Math.round(Math.min(vh - h - 6, feet.y + 10))
    bub.classList.toggle('below', below)
    bub.style.transform = `translate(${left}px, ${topY}px)`
    bub.style.setProperty('--tx', `${Math.round(Math.max(12, Math.min(w - 12, head0.x - left)))}px`)
  }

  // -- reading meeting.js: when the live list's version for it moves (no reading otherwise)
  let ver = null
  let reading = false
  let meetId = ''
  function apply(d) {
    const m = clean(d)
    const wasGoing = going()
    M = m
    const isFirst = first
    if (M && M.id !== meetId) {                     // a new meeting: its unread count from where this browser left it
      meetId = M.id
      const s0 = get('ao-meet-seen').split(':')
      seenN = s0[0] === M.id ? +s0[1] || 0 : 0
    }
    player.push(M, isFirst ? { jump: true } : undefined)
    const on = going()
    if (on && !wasGoing && !isFirst && window.__aoMeetSay && desk && desk.classList.contains('tab-meet')) window.__aoMeetSay.set(true)
    if (window.__aoMeetSay) window.__aoMeetSay.live(on)
    transcript()
    step()
    if (inView()) seen()
    else dots()
    first = false
  }
  function read() {
    if (reading) return
    reading = true
    const done = d => {
      reading = false
      try { apply(d) } catch (e) { console.error(e) }
    }
    if (LIVE) {
      fetch(`meeting.js?${q.replace(/&$/, '')}`, { cache: 'no-cache', credentials: 'omit' })
        .then(r => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
        .then(t => {
          const m = /^window\.__aoMeeting = ([\s\S]*);\s*$/.exec(t)
          done(m ? JSON.parse(m[1]) : null)
        })
        .catch(() => { reading = false; ver = null })
      return
    }
    window.__aoMeeting = undefined
    const s = document.createElement('script')
    s.src = `meeting.js?${q}t=${Date.now()}`
    s.onload = () => { s.remove(); done(window.__aoMeeting || null) }
    s.onerror = () => { s.remove(); reading = false }
    document.head.appendChild(s)
  }
  document.addEventListener('nr:data', e => {
    const d = e.detail && e.detail.data
    if (!d) return
    const v = typeof d.meet === 'string' ? d.meet : ''
    if (v === ver) return
    ver = v
    if (v) read()
    else apply(null)
  })

  // -- calling a meeting: the topic is your own words, sent as text; the plugin checks there's none on already
  async function call(text) {
    if (!CAN_SEND || live()) return
    callBtn.disabled = true
    msg.textContent = 'Calling…'
    try {
      const r = await fetch('meeting', { method: 'POST', credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'text/plain;charset=utf-8', 'X-Office-Token': KEY },
        body: JSON.stringify({ topic: String(text || '').trim().slice(0, 120) }) })
      msg.textContent = r.ok ? 'Called. Claude gathers the departments.' : r.status === 429 ? 'Too many at once. Try again in a minute.' : `Not called (${r.status}).`
      if (r.ok) topic.value = ''
    } catch (err) {
      msg.textContent = 'Not called: the bridge is not answering.'
    }
    callBtn.disabled = live()
    setTimeout(() => { if (/^Called|^Not|^Too/.test(msg.textContent)) msg.textContent = '' }, 8000)
  }
  callForm.addEventListener('submit', e => {
    e.preventDefault()
    call(topic.value)
  })
  // open the transcript, and the topic box when calling
  function show(focusTopic) {
    if (window.__aoDesk && window.__aoDesk.closed()) window.__aoDesk.set(true, true)
    tab('meet', true)
    if (focusTopic && !live()) setTimeout(() => topic.focus({ preventScroll: true }), 160)
  }
  // the screen's plate: a click opens the Meeting tab with the topic box
  const inPlate = (ax, ay) => plate && ax >= C.call[0] && ax <= C.call[2] && ay >= C.call[1] && ay <= C.call[3]
  svg.addEventListener('click', e => {
    const vb = svg.viewBox.baseVal
    const r = svg.getBoundingClientRect()
    const ax = (vb.x + (e.clientX - r.left) / r.width * vb.width) / 2
    const ay = (vb.y + (e.clientY - r.top) / r.height * vb.height) / 2
    if (inPlate(ax, ay)) show(true)
  })

  window.__aoMeetDebug = { get m() { return M }, get room() { return player.state() }, apply, show, tab }
  drawScreen()
  header()
  dots()
  lights()
  setInterval(step, 200)
  window.addEventListener('resize', bubble)
})()
