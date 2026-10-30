import { expect, test } from 'claude-code/testing'

import { boardPrims, boardRows, mergedRead, parseBranches } from '../hooks/board'
import { seasonOf } from '../hooks/clock'
import { EGG_CODES, eggOf } from '../hooks/eggs'

// The codes typed at the front desk are the office's own: eggOf is what register.tsx asks before anything from the
// bridge becomes a prompt (the page asks the same patterns first, and bridge.py drops them too: tests/test_bridge.py).
test('an egg code is caught, and nothing else is', async () => {
  for (const t of ['/confetti', '  /confetti  ', '/CONFETTI']) expect(eggOf(t)).toBe('confetti')
  for (const t of ['please /confetti', '/confetti now', 'confetti', '', ' '.repeat(50) + '/confetti']) expect(eggOf(t)).toBe(undefined)
  expect(eggOf(undefined)).toBe(undefined)
  expect(eggOf(42)).toBe(undefined)
  expect(Object.keys(EGG_CODES)).toEqual(['confetti'])
})

test('the seasons follow the local calendar', async () => {
  expect(seasonOf(new Date(2026, 9, 30).getTime())).toBe('halloween')
  expect(seasonOf(new Date(2026, 10, 2).getTime())).toBe('thanksgiving')
  expect(seasonOf(new Date(2026, 10, 26).getTime())).toBe('thanksgiving')   // the fourth Thursday
  expect(seasonOf(new Date(2026, 10, 27).getTime())).toBe('holiday')
  expect(seasonOf(new Date(2027, 0, 2).getTime())).toBe('holiday')
  expect(seasonOf(new Date(2027, 5, 1).getTime())).toBe('')
})

test('the whiteboard reads git output defensively and never builds a dangerous ref', async () => {
  const now = 1_800_000_000_000
  const s = Math.floor(now / 1000)
  const b = parseBranches(['worktree /a\nbranch refs/heads/feature/x\n\nworktree /b\nbranch refs/heads/--upload-pack=evil\n',
    `feature/x\t${s - 60}\nmain\t${s - 9999}\nold\t${s - 99 * 86400}\n`, 'origin/main\n', 'feature/x\n'])!
  expect(b.trees).toEqual(['feature/x'])
  expect(b.base).toBe('main')
  expect(b.here).toBe('feature/x')
  expect(mergedRead('main')).toEqual(['for-each-ref', '--merged=refs/heads/main', '--format=%(refname:short)', 'refs/heads'])
  expect(mergedRead('-x')).toBe(undefined)
  expect(mergedRead('a..b')).toBe(undefined)
  const { rows } = boardRows(b, 'main\n', [{ task: 'Fix feature/x tests', desk: 'd1', done: false }], now)
  expect(rows.map(r => [r.branch, r.state, r.here, r.who.join()])).toEqual([['feature/x', 'open', true, 'claude,d1']])
  expect(boardRows(undefined, undefined, [], now).why).toBe('not a git repo')
  const prims = boardPrims(rows, '', { label: 'Launch', at: now + 3 * 86_400_000 + 4 * 3_600_000 }, now, { claude: '#d97757', d1: '#ef4444' })
  expect(JSON.stringify(prims)).toMatch(/"LAUNCH".*"3D 4H"/)
})
