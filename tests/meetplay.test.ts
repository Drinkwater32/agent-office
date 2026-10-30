import { expect, test } from 'claude-code/testing'

import '../popout/meetplay.js'

// The conference room's playback (popout/meetplay.js): the page script, loaded as it is, ticked with a fake clock
// and a fake engine whose walks take WALK seconds.
type Turn = { n: number; speaker: string; kind: string; text: string; title: string; at: number }
type Snap = { id: string; title: string; topic: string; status: string; live: boolean; agenda: unknown[];
  people: { id: string; seat: number }[]; turns: Turn[] }
type View = { id: string; status: string; decisions: string[] } | null
type State = { view: View; inRoom: boolean; turn: { turn: Turn; i: number; pages: string[]; speaking: boolean } | null;
  played: Set<number>; queued: number; busy: boolean }
type Player = { push(m: Snap | null, opt?: { jump?: boolean; wall?: number }): void;
  tick(now: number, room: { ready(): boolean; seated(id: string): boolean }): State; takeInstant(): boolean }
const MP = (globalThis as unknown as { __aoMeetPlay: { create(o?: object): Player; pagesOf(t: string): string[];
  TIMING: Record<string, number> } }).__aoMeetPlay
const T = MP.TIMING

const PEOPLE = [{ id: 'claude', seat: 0 }, { id: 'owner', seat: 1 }, { id: 'engineering', seat: 2 }, { id: 'review', seat: 3 }]
const snap = (status: string, turns: Turn[], id = 'cat'): Snap =>
  ({ id, title: 'Name the cat', topic: '', status, live: status !== 'ended', agenda: [], people: PEOPLE, turns })
const turn = (n: number, speaker: string, kind: string, text: string): Turn => ({ n, speaker, kind, text, title: '', at: 0 })
const T1 = turn(1, 'engineering', 'proposal', 'Call her Biscuit: short, friendly, and easy to shout across the office.')
const T2 = turn(2, 'review', 'proposal', 'Mochi. It reads well on a name tag and nobody else in the building has it.')
const T3 = turn(3, 'claude', 'decision', 'The cat is Mochi.')
const pageSecs = (s: string) => Math.min(T.TURN_MAX!, T.TURN_BASE! + T.TURN_CHAR! * s.length)

// a fake engine: a walk to the table (or out) takes `walk` seconds; the log keeps what the room did, and when
function rig(walk = 5) {
  const p = MP.create()
  let now = 0
  let enteredAt = -1
  const log: { at: number; what: string }[] = []
  let last = { inRoom: false, speaking: '', status: '', decisions: 0 }
  const room = { ready: () => enteredAt >= 0 && now - enteredAt >= walk, seated: () => enteredAt >= 0 && now - enteredAt >= walk }
  const run = (secs: number, dt = 0.1) => {
    for (const end = now + secs; now < end - 1e-9; now = Math.round((now + dt) * 1000) / 1000) {
      const s = p.tick(now, room)
      if (s.inRoom !== last.inRoom) {
        enteredAt = s.inRoom ? now : -1
        log.push({ at: now, what: s.inRoom ? 'walk in' : 'walk out' })
      }
      const sp = s.turn && s.turn.speaking ? `${s.turn.turn.n}.${s.turn.i}` : ''
      if (sp !== last.speaking) {
        if (last.speaking) log.push({ at: now, what: `end ${last.speaking}` })
        if (sp) log.push({ at: now, what: `say ${sp}` })
      }
      const st = s.view ? s.view.status : ''
      if (st !== last.status) log.push({ at: now, what: `status ${st}` })
      const d = s.view ? s.view.decisions.length : 0
      if (d !== last.decisions) log.push({ at: now, what: `decisions ${d}` })
      last = { inRoom: s.inRoom, speaking: sp, status: st, decisions: d }
    }
  }
  const at = (what: string) => log.find(x => x.what === what)?.at ?? -1
  return { p, run, log, at, get now() { return now }, room }
}

test('a 3-turn meeting sent within a second still walks in, speaks each turn, and walks out, in order', async () => {
  const r = rig(5)
  r.p.push(null, { jump: true })                    // the page was open before the meeting
  r.p.push(snap('gathering', []))
  r.run(0.2)
  r.p.push(snap('in_session', [T1]))
  r.run(0.2)
  r.p.push(snap('in_session', [T1, T2]))
  r.run(0.2)
  r.p.push(snap('wrap_up', [T1, T2, T3]))
  r.run(0.2)
  r.p.push(snap('ended', [T1, T2, T3]))
  r.run(120)
  const order = r.log.map(x => x.what).filter(w => /^(walk|say|end) /.test(w))
  expect(order).toEqual(['walk in', 'say 1.0', 'end 1.0', 'say 2.0', 'end 2.0', 'say 3.0', 'end 3.0', 'walk out'])
  // seated before the first word: the walk, then a beat
  expect(r.at('say 1.0')).toBeGreaterThanOrEqual(r.at('walk in') + 5 + T.SIT! - 0.11)
  // each bubble stays up its reading time
  for (const t of [T1, T2, T3]) {
    expect(r.at(`end ${t.n}.0`) - r.at(`say ${t.n}.0`)).toBeGreaterThanOrEqual(pageSecs(t.text) - 0.11)
  }
  // the decision is on the screen before they get up, and they stay a while with it
  expect(r.at('decisions 1')).toBeLessThan(r.at('walk out'))
  expect(r.at('walk out') - r.at('end 3.0')).toBeGreaterThanOrEqual(T.LINGER_MIN! - 0.11)
  // the screen moves through the states in order
  const states = r.log.filter(x => x.what.startsWith('status ')).map(x => x.what.slice(7))
  expect(states).toEqual(['gathering', 'in_session', 'wrap_up', 'ended'])
  // and the whole thing took a watchable time, though it was sent in under a second
  expect(r.at('walk out')).toBeGreaterThan(5 + 3 * T.TURN_BASE!)
})

test('a meeting seen only once it had ended still plays from the walk in', async () => {
  const r = rig(3)
  r.p.push(null, { jump: true })
  r.p.push(snap('ended', [T1, T2, T3]))             // the page's poll missed every step in between
  r.run(120)
  const order = r.log.map(x => x.what).filter(w => /^(walk|say) /.test(w))
  expect(order).toEqual(['walk in', 'say 1.0', 'say 2.0', 'say 3.0', 'walk out'])
  const states = r.log.filter(x => x.what.startsWith('status ')).map(x => x.what.slice(7))
  expect(states).toEqual(['gathering', 'in_session', 'wrap_up', 'ended'])      // each turn's own state, never ahead
})

test('a long turn is paged, each page held for its reading time, never more than the cap', async () => {
  const long = turn(1, 'engineering', 'proposal', Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ') + '.')
  const pages = MP.pagesOf(long.text)
  expect(pages.length).toBeGreaterThan(1)
  for (const pg of pages) expect(pg.length).toBeLessThanOrEqual(125)
  const r = rig(1)
  r.p.push(null, { jump: true })
  r.p.push(snap('in_session', [long]))
  r.run(120)
  pages.forEach((pg, i) => {
    const held = r.at(`end 1.${i}`) - r.at(`say 1.${i}`)
    expect(held).toBeGreaterThanOrEqual(pageSecs(pg) - 0.11)
    expect(held).toBeLessThanOrEqual(T.TURN_MAX! + 0.11)
  })
})

test('a walk that never finishes is waited for only up to the cap', async () => {
  const p = MP.create()
  p.push(null, { jump: true })
  p.push(snap('in_session', [T1]))
  const never = { ready: () => false, seated: () => false }
  let spokeAt = -1
  for (let now = 0; now < 60 && spokeAt < 0; now += 0.1) {
    const s = p.tick(now, never)
    if (s.turn && s.turn.speaking) spokeAt = now
  }
  expect(spokeAt).toBeGreaterThan(T.WALK_MAX!)
  expect(spokeAt).toBeLessThan(T.WALK_MAX! + T.SIT! + T.SPEAKER_WAIT! + 0.5)
})

test('a reload mid-meeting jumps to where it stands, without the walk or the old turns', async () => {
  const p = MP.create()
  const wall = 1_800_000_000_000
  const old = [T1, T2].map(t => ({ ...t, at: wall - 600_000 }))
  p.push(snap('discussion', old), { jump: true, wall })
  expect(p.takeInstant()).toBe(true)                // everyone seated at once
  expect(p.takeInstant()).toBe(false)
  const s = p.tick(0, { ready: () => true, seated: () => true })
  expect(s.inRoom).toBe(true)
  expect(s.view!.status).toBe('discussion')
  expect([...s.played].sort()).toEqual([1, 2])
  let spoke = false
  for (let now = 0; now < 30; now += 0.2) if (p.tick(now, { ready: () => true, seated: () => true }).turn) spoke = true
  expect(spoke).toBe(false)
  // an ended meeting: nobody in the room, its decisions on the screen
  const q = MP.create()
  q.push(snap('ended', [T1, T2, { ...T3, at: wall - 1000 }]), { jump: true, wall })
  const e = q.tick(0, { ready: () => true, seated: () => true })
  expect(e.inRoom).toBe(false)
  expect(e.view!.decisions).toEqual(['The cat is Mochi.'])
  // a turn said seconds before the reload still plays; the older ones don't
  const f = MP.create()
  f.push(snap('discussion', [{ ...T1, at: wall - 600_000 }, { ...T2, at: wall - 2000 }]), { jump: true, wall })
  let said: number[] = []
  for (let now = 0; now < 30; now += 0.2) {
    const st = f.tick(now, { ready: () => true, seated: () => true })
    if (st.turn && st.turn.speaking && !said.includes(st.turn.turn.n)) said = [...said, st.turn.turn.n]
  }
  expect(said).toEqual([2])
})

test('a new meeting waits for the one playing to finish', async () => {
  const r = rig(2)
  r.p.push(null, { jump: true })
  r.p.push(snap('ended', [T1, T2, T3], 'first'))
  r.run(1)
  r.p.push(snap('gathering', [], 'second'))
  r.p.push(snap('in_session', [turn(1, 'review', 'proposal', 'Pepper.')], 'second'))
  let sawSecondEarly = false
  const p = r.p
  for (let i = 0; i < 1200; i++) {
    r.run(0.1)
    const s = p.tick(r.now, r.room)
    if (s.view && s.view.id === 'second' && r.at('walk out') < 0) sawSecondEarly = true
  }
  expect(sawSecondEarly).toBe(false)
  const says = r.log.map(x => x.what).filter(w => w.startsWith('say ') || w.startsWith('walk '))
  expect(says).toEqual(['walk in', 'say 1.0', 'say 2.0', 'say 3.0', 'walk out', 'walk in', 'say 1.0'])
})

test('nothing is dropped: updates that come while it plays are queued', async () => {
  const r = rig(1)
  r.p.push(null, { jump: true })
  const turns: Turn[] = []
  for (let n = 1; n <= 8; n++) {
    turns.push(turn(n, n % 2 ? 'engineering' : 'review', n === 1 ? 'proposal' : 'reply', `Line ${n}.`))
    r.p.push(snap(n === 1 ? 'in_session' : 'discussion', [...turns]))
    r.run(0.5)
  }
  r.p.push(snap('ended', [...turns]))
  r.run(200)
  const said = r.log.filter(x => /^say \d+\.0$/.test(x.what)).map(x => +x.what.slice(4, -2))
  expect(said).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
})

test('a huge backlog skips ahead to the newest state and sums up quickly', async () => {
  const r = rig(1)
  r.p.push(null, { jump: true })
  r.p.push(snap('gathering', []))
  r.run(3)                                          // seated
  const turns: Turn[] = []
  for (let n = 1; n <= 30; n++) turns.push(turn(n, n > 28 ? 'claude' : 'engineering', n > 28 ? 'decision' : 'reply', `Point ${n}.`))
  r.p.push(snap('ended', turns))
  const s = r.p.tick(r.now, r.room)
  expect(s.queued).toBe(0)                          // skipped: nothing waiting
  expect(s.played.size).toBe(30)
  expect(s.view!.status).toBe('ended')
  expect(s.view!.decisions).toEqual(['Point 29.', 'Point 30.'])
  expect(s.inRoom).toBe(true)                       // still seated for the summary...
  const from = r.now
  r.run(T.SUMMARY! + T.EXIT! + 1)
  expect(r.at('walk out') - from).toBeGreaterThanOrEqual(T.SUMMARY! - 0.11)   // ...then out, soon
  expect(r.at('walk out') - from).toBeLessThan(T.SUMMARY! + 1)
  expect(r.log.some(x => x.what.startsWith('say '))).toBe(false)
  // a backlog for a room nobody had entered: the screen sums it up, nobody walks in just to walk out
  const e = MP.create()
  e.push(null, { jump: true })
  e.push(snap('ended', turns))
  const s2 = e.tick(0, r.room)
  expect(s2.inRoom).toBe(false)
  expect(s2.busy).toBe(true)
  expect(s2.view!.decisions.length).toBe(2)
  expect(e.tick(T.SUMMARY! + 0.1, r.room).busy).toBe(false)
})
