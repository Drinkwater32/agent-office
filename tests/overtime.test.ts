import { expect, test } from 'claude-code/testing'

import { parseConfig } from '../hooks/config'
import * as U from '../hooks/usage'

// Overtime: with extra usage on the account, turns keep being answered past the 5-hour limit. The engine exposes no
// extra-usage flag or credits (only the windows' percentages and resets, the session's cost, and the rate-limit
// error), so overtime is a turn answered while a window reads 100%. Then the office stays open (or opens again) and
// shows OVERTIME until the reset; a rate-limit error still closes it. Once seen, the next cycle's close is skipped.

const T0 = Date.parse('2026-10-29T15:00:00Z')
const RESET = '2026-10-29T19:40:00Z'
const NEXT = '2026-10-30T00:40:00Z'
const five = (percentUsed: number, resetsAt = RESET) => [{ kind: 'five_hour', percentUsed, resetsAt }]
const CFG: U.Thresholds = { warnAt: 90, closeAt: 98, extra: 'auto' }
const fresh = (): U.UsageMem => ({ warned: [], last: [] })

test('auto, not seen yet: 98% closes as before; a turn answered at 100% is overtime (open again, OVERTIME shown)', () => {
  let m = U.step(fresh(), CFG, five(98), T0).mem
  expect(m.closed?.why).toBe('limit')
  m = U.step(m, CFG, five(100), T0 + 60_000).mem
  const s = U.answered(m, T0 + 70_000, CFG, 12.5)
  expect(s.overtime?.kind).toBe('five_hour')
  expect(s.mem.closed).toBeUndefined()
  expect(s.mem.over).toMatchObject({ kind: 'five_hour', until: Date.parse(RESET), cost0: 12.5 })
  expect(s.mem.extraSeen).toBe(T0 + 70_000)
  expect(U.view(s.mem, CFG, T0 + 70_000)).toMatchObject({ over: true, closed: false, warn: false })
  const ro = U.readout(s.mem, CFG, 40, T0 + 70_000)
  expect(ro.main).toMatchObject({ over: true, left: '4h 38m' })
  expect(U.readoutLine(ro)).toContain('OVERTIME 4h 38m left')
  expect(U.answered(s.mem, T0 + 80_000, CFG).overtime).toBeUndefined()      // the same overtime: nothing new
})

test('a turn answered under 100% is not overtime; the closed office stays closed', () => {
  const m = U.step(fresh(), CFG, five(98.5), T0).mem
  const s = U.answered(m, T0 + 1000, CFG)
  expect(s.overtime).toBeUndefined()
  expect(s.mem.closed?.why).toBe('limit')
})

test('seen at work: the next cycle skips the close and goes straight to overtime at 100%; it ends with the window', () => {
  let s = U.step({ ...fresh(), extraSeen: T0 - 86_400_000 }, CFG, five(98, NEXT), T0)
  expect(s.close).toBeUndefined()
  expect(s.mem.closed).toBeUndefined()
  expect(s.warn).toBeDefined()                                   // the warning (and its handoff) is kept as it was
  s = U.step(s.mem, CFG, five(100, NEXT), T0 + 60_000)
  expect(s.overtime?.percentUsed).toBe(100)
  expect(U.step(s.mem, CFG, undefined, Date.parse(NEXT) + 1000).overEnd).toBe(true)
  expect(U.step(s.mem, CFG, five(5, '2026-10-30T05:40:00Z'), T0 + 120_000).mem.over).toBeUndefined()
  expect(U.step({ ...fresh(), extraSeen: T0 - 31 * 86_400_000 }, CFG, five(98), T0).close).toBeDefined()   // too long ago
})

test('a rate-limit error in overtime closes the office: no extra usage after all, or it ran out', () => {
  const m: U.UsageMem = { ...fresh(), last: five(100), extraSeen: T0, over: { kind: 'five_hour', key: `five_hour|${RESET}`, since: T0 } }
  const s = U.closeForError(m, T0 + 1000)
  expect(s.mem.over).toBeUndefined()
  expect(s.mem.closed?.why).toBe('error')
  expect(U.view(s.mem, CFG, T0 + 1000)).toMatchObject({ closed: true, over: false })
})

test('extra off: close at closeAt, never overtime; on: never close on a percentage', () => {
  const off: U.Thresholds = { ...CFG, extra: 'off' }
  const m = U.step({ ...fresh(), extraSeen: T0 }, off, five(100), T0).mem
  expect(m.closed?.why).toBe('limit')
  expect(U.answered(m, T0 + 1, off).overtime).toBeUndefined()
  const on: U.Thresholds = { ...CFG, extra: 'on' }
  expect(U.step(fresh(), on, five(99), T0).mem.closed).toBeUndefined()
  expect(U.step(fresh(), on, five(100), T0).overtime).toBeDefined()
})

test("/office-usage in overtime: the time left, this session's cost since, and what isn't exposed", () => {
  const m: U.UsageMem = { ...fresh(), last: five(100), extraSeen: T0,
    over: { kind: 'five_hour', key: `five_hour|${RESET}`, since: T0, until: Date.parse(RESET), cost0: 10 } }
  const r = U.report(m, CFG, '.agent-office/HANDOFF.md', 40, T0 + 60_000, 13.456)
  expect(r).toContain('OVERTIME on extra usage')
  expect(r).toContain('(4h 39m left)')
  expect(r).toContain('$3.46 at API prices since overtime began')
  expect(r).toContain("credits used and left aren't exposed")
  expect(U.cleanMem(JSON.parse(JSON.stringify(m)))).toEqual(m)
  expect(U.leftLabel(T0 + 30_000, T0)).toBe('under 1m')
  expect(U.leftLabel(T0 + 40 * 60_000, T0)).toBe('40m')
})

test('the config: usage.extra is auto, on or off (auto by default; anything else warns)', () => {
  expect(parseConfig(undefined).config.usage.extra).toBe('auto')
  expect(parseConfig(JSON.stringify({ usage: { extra: 'on' } })).config.usage.extra).toBe('on')
  const bad = parseConfig(JSON.stringify({ usage: { extra: 'maybe' } }))
  expect(bad.config.usage.extra).toBe('auto')
  expect(bad.warnings.some(w => w.includes('usage.extra'))).toBe(true)
})
