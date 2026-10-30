import { expect, test } from 'claude-code/testing'

import { parseConfig } from '../hooks/config'
import * as U from '../hooks/usage'

const NOW = 1_800_000_000_000
const T: U.Thresholds = { warnAt: 90, closeAt: 98 }
const at = (pct: number, resetIn = 3_600_000) => [{ kind: 'five_hour', percentUsed: pct, resetsAt: new Date(NOW + resetIn).toISOString() }]

test('the warning comes once a window cycle, at the threshold, and asks for the handoff', async () => {
  let s = U.step(U.EMPTY_MEM, T, at(89.9), NOW)
  expect(s.warn).toBe(undefined)
  s = U.step(s.mem, T, at(90), NOW + 1)
  expect(s.warn?.percentUsed).toBe(90)
  expect(s.mem.asked).toBe(NOW + 1)
  expect(U.step(s.mem, T, at(93), NOW + 2).warn).toBe(undefined)          // the same cycle: no second warning
  expect(U.step(s.mem, T, at(91, 7_200_000), NOW + 3).warn?.percentUsed).toBe(91)   // a new cycle warns again
})

test('the office closes at the close threshold and opens when the window resets or falls under 50%', async () => {
  const s = U.step(U.EMPTY_MEM, T, at(98), NOW)
  expect(s.close?.percentUsed).toBe(98)
  expect(s.warn?.percentUsed).toBe(98)                                     // straight to 98: the handoff is asked for too
  expect(s.mem.closed?.until).toBe(NOW + 3_600_000)
  expect(U.step(s.mem, T, undefined, NOW + 60_000).reopen).toBe(undefined)
  expect(U.step(s.mem, T, undefined, NOW + 3_600_000).reopen).toBe(true)   // the poll: the reset time passed
  expect(U.step(s.mem, T, at(12), NOW + 60_000).reopen).toBe(true)         // a reading under 50%
  const custom = U.step(U.EMPTY_MEM, { warnAt: 70, closeAt: 80 }, at(81), NOW)
  expect(!!custom.close).toBe(true)
})

test('a rate-limit error closes the office until a turn answers', async () => {
  const s = U.closeForError(U.EMPTY_MEM, NOW)
  expect(s.mem.closed?.why).toBe('error')
  expect(U.answered(s.mem, NOW + 1).reopen).toBe(true)
  expect(U.answered(U.step(U.EMPTY_MEM, T, at(99), NOW).mem, NOW + 1).reopen).toBe(undefined)  // a limit close waits for its reset
})

test('readings and stored memory are checked before use', async () => {
  expect(U.cleanLimits([{ kind: 'five_hour', percentUsed: 'lots' }, { kind: 'BAD KIND', percentUsed: 5 },
    { kind: 'seven_day', percentUsed: 12, resetsAt: 'not a date' }, null])).toEqual([{ kind: 'seven_day', percentUsed: 12 }])
  const m = U.cleanMem({ warned: ['x'.repeat(200), 'five_hour|z'], asked: -4, closed: { kind: 'k', key: 'k', at: 5, why: 'hack' } })
  expect(m.warned).toEqual(['five_hour|z'])
  expect(m.asked).toBe(undefined)
  expect(m.closed).toBe(undefined)
})

test('the readout colors by the thresholds: amber from 15 under the warning, red from it', async () => {
  expect(U.levelOf(74, T)).toBe('ok')
  expect(U.levelOf(75, T)).toBe('amber')
  expect(U.levelOf(90, T)).toBe('red')
  const ro = U.readout(U.step(U.EMPTY_MEM, T, at(82.6), NOW).mem, T, 41.4, NOW)
  expect(ro.main?.pct).toBe(82)
  expect(ro.main?.level).toBe('amber')
  expect(ro.main?.resets).toMatch(/^\d{1,2}:\d{2} [AP]M$/)
  expect(ro.ctx).toEqual({ pct: 41, level: 'ok' })
  expect(U.readoutLine(ro)).toMatch(/^5-hour 82% · resets .* · context 41%$/)
})

test('the handoff prompt rewrites the one file whole, never appends', async () => {
  const p = U.handoffPrompt(at(91)[0]!, NOW, '.agent-office/HANDOFF.md', '/work/app/.agent-office/HANDOFF.md')
  expect(p).toMatch(/REWRITE the handoff file `\.agent-office\/HANDOFF.md` \(\/work\/app\/\.agent-office\/HANDOFF.md\)/)
  expect(p).toMatch(/create its folder/)
  expect(p).toMatch(/never append/)
  expect(p).toMatch(/Handoff saved/)
  expect(U.HANDOFF_REPLY.test('Done. Handoff saved.')).toBe(true)
})

test("the config's usage thresholds and handoff file are checked", async () => {
  expect(parseConfig(undefined).config.usage).toEqual({ warnAt: 90, closeAt: 98, handoffFile: '.agent-office/HANDOFF.md', extra: 'auto' })
  const ok = parseConfig(JSON.stringify({ usage: { warnAt: 80, closeAt: 95, handoffFile: 'docs/handoff.md' } }))
  expect(ok.config.usage).toEqual({ warnAt: 80, closeAt: 95, handoffFile: 'docs/handoff.md', extra: 'auto' })
  expect(ok.warnings.length).toBe(0)
  const bad = parseConfig(JSON.stringify({ usage: { warnAt: 99, closeAt: 60, handoffFile: '../../etc/passwd' } }))
  expect(bad.config.usage).toEqual({ warnAt: 90, closeAt: 98, handoffFile: '.agent-office/HANDOFF.md', extra: 'auto' })
  expect(bad.warnings.length).toBe(2)
  expect(parseConfig(JSON.stringify({ usage: { handoffFile: 'notes.exe' } })).config.usage.handoffFile).toBe('.agent-office/HANDOFF.md')
  expect(parseConfig(JSON.stringify({ usage: { handoffFile: '' } })).config.usage.handoffFile).toBe('')
  expect(parseConfig(JSON.stringify({ usage: { warnAt: 90.5 } })).warnings[0]).toMatch(/whole number/)
})

test('the whiteboard deadline is a real local date', async () => {
  expect(parseConfig(JSON.stringify({ deadline: { label: 'Launch', at: '2026-12-01T17:00' } })).config.deadline)
    .toEqual({ label: 'Launch', y: 2026, mo: 12, d: 1, h: 17, mi: 0 })
  expect(parseConfig(JSON.stringify({ deadline: { label: 'Launch', at: '2026-02-30' } })).config.deadline).toBe(undefined)
  expect(parseConfig(JSON.stringify({ deadline: { at: 'tomorrow' } })).warnings[0]).toMatch(/deadline.at/)
})
