// The whiteboard in the conference room: the branches of this session's project (its git repo, read-only) and their
// state, with a dot for each department that has an agent on one, and a countdown to your deadline when the config
// sets one. Pure functions only: register.tsx runs the git reads (never through a shell) and hands their output here.
//
// The board is drawn from primitives the page (extras.js) builds as SVG, every word set as text:
//   t [x, y, size, color, text, anchor ('s', 'm', 'e'), bold (1)]     r [x, y, w, h, color]

import { untilText } from './clock'

export type Prim = { t: [number, number, number, string, string, ('s' | 'm' | 'e')?, (0 | 1)?] } | { r: [number, number, number, number, string] }
export type BranchState = 'open' | 'merged' | 'base'
export type BoardRow = { branch: string; state: BranchState; who: string[]; here: boolean }
export type AgentLite = { task: string; desk: string; done: boolean }

// every git call starts so: no optional locks taken, no fsmonitor hook run, whatever the repo's own config says
export const GIT_SAFE = ['--no-optional-locks', '-c', 'core.fsmonitor=', '-c', 'core.untrackedCache=false']
// the reads, in order (git -C <project> ...): the worktrees, the branches by their last commit, the remote's default
export const GIT_READS = [
  ['worktree', 'list', '--porcelain'],
  ['for-each-ref', '--count=60', '--sort=-committerdate', '--format=%(refname:short)%09%(committerdate:unix)', 'refs/heads'],
  ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
  ['symbolic-ref', '--quiet', '--short', 'HEAD'],
]
const BRANCH = /^(?!-)[\w./-]{1,80}$/
/** The last read, once the default branch is known: the branches already merged into it. */
export const mergedRead = (base: string) => (BRANCH.test(base) && !base.includes('..')
  ? ['for-each-ref', `--merged=refs/heads/${base}`, '--format=%(refname:short)', 'refs/heads'] : undefined)

export type Branches = { trees: string[]; recent: { name: string; at: number }[]; base: string; here: string } | undefined
/** The reads' output: the worktrees' branches, the branches, the default branch, this folder's branch. */
export function parseBranches(outs: (string | undefined)[]): Branches {
  const [wt, refs = '', head = '', mine = ''] = outs
  if (wt === undefined) return undefined
  const trees: string[] = []
  for (const ln of wt.split(/\r?\n/)) {
    if (!ln.startsWith('branch ')) continue
    const b = ln.slice(7).trim().replace(/^refs\/heads\//, '')
    if (BRANCH.test(b)) trees.push(b)
  }
  const here = BRANCH.test(mine.trim()) ? mine.trim() : ''
  const recent = refs.split(/\r?\n/).map(l => l.split('\t')).filter(p => p.length >= 2 && BRANCH.test(p[0] ?? ''))
    .map(([name = '', at = '0']) => ({ name, at: (+at || 0) * 1000 })).slice(0, 60)
  const names = new Set(recent.map(r => r.name))
  const fromRemote = head.trim().replace(/^origin\//, '')
  const base = BRANCH.test(fromRemote) && names.has(fromRemote) ? fromRemote : names.has('main') ? 'main' : names.has('master') ? 'master' : ''
  return { trees, recent, base, here }
}

const GENERIC = new Set(['main', 'master', 'dev', 'develop', 'fix', 'fixes', 'feature', 'feat', 'test', 'tests', 'wip', 'work',
  'branch', 'update', 'more', 'chore', 'release'])
const DAY = 86_400_000

/** The rows: this folder's branch first, then the ones an agent is on, then the latest commits; three at most. */
export function boardRows(b: Branches, mergedOut: string | undefined, agents: AgentLite[], now: number): { rows: BoardRow[]; why: string } {
  if (!b) return { rows: [], why: 'not a git repo' }
  const merged = new Set((mergedOut ?? '').split(/\r?\n/).map(s => s.trim()).filter(Boolean))
  const names = new Set<string>()
  for (const t of b.trees) if (t !== b.base) names.add(t)
  for (const r of b.recent) if (r.name !== b.base && now - r.at < 14 * DAY) names.add(r.name)
  if (b.here) names.add(b.here)
  const active = agents.filter(a => !a.done)
  const rows = [...names].map(branch => {
    const words = branch.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !GENERIC.has(w))
    const on = active.filter(a => {
      const t = a.task.toLowerCase()
      return t.includes(branch.toLowerCase()) || (words.length > 0 && words.every(w => t.includes(w)))
    })
    const at = b.recent.find(r => r.name === branch)?.at ?? 0
    const state: BranchState = branch === b.base ? 'base' : merged.has(branch) ? 'merged' : 'open'
    const who = [...new Set([...(branch === b.here ? ['claude'] : []), ...on.map(a => a.desk)])].slice(0, 5)
    const keep = branch === b.here || on.length > 0 || state !== 'merged' || now - at < 2 * DAY
    const rank = branch === b.here ? 0 : on.length ? 1 : 2
    return { row: { branch, state, who, here: branch === b.here }, keep, rank, at }
  }).filter(x => x.keep).sort((p, q) => p.rank - q.rank || q.at - p.at).slice(0, 3).map(x => x.row)
  return { rows, why: rows.length ? '' : 'no branches yet' }
}

// -- the board's face, in art pixels from its top-left (its writing area is BOARD wide and tall)
export const BOARD = [40, 22] as const
const INK = '#2b2342'
const DIM = '#8a83a3'
const STATE_COLOR: Record<BranchState, string> = { open: '#2563eb', merged: '#15803d', base: '#6b6385' }
const STATE_WORD: Record<BranchState, string> = { open: 'OPEN', merged: 'MERGED', base: 'BASE' }
const fit = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

export function boardPrims(rows: BoardRow[], why: string, deadline: { label: string; at: number } | undefined, now: number,
  colors: Record<string, string>): Prim[] {
  const out: Prim[] = []
  if (deadline) {
    const left = deadline.at - now
    out.push({ t: [1, 4.2, 2.8, INK, fit(deadline.label.toUpperCase(), 12), 's', 1] },
      { t: [39, 4.2, 2.8, '#dc2626', left <= 0 ? 'NOW' : untilText(left), 'e', 1] })
  } else {
    out.push({ t: [1, 4.2, 2.8, INK, 'BRANCHES', 's', 1] })
    if (rows.length) out.push({ t: [39, 4.2, 2.4, DIM, String(rows.length), 'e', 1] })
  }
  out.push({ r: [1, 5.6, 38, 0.6, '#c9c2d6'] })
  if (!rows.length) out.push({ t: [20, 13.5, 2.5, DIM, (why || 'no branches yet').toUpperCase(), 'm'] })
  rows.slice(0, 3).forEach((r, i) => {
    const y = +(10.4 + i * 5.2).toFixed(1)
    out.push({ r: [1, +(y - 2.2).toFixed(1), 2, 2, STATE_COLOR[r.state]] },
      { t: [4, y, 2.6, INK, fit(r.branch, 15), 's', r.here ? 1 : 0] },
      { t: [39, y, 2.1, STATE_COLOR[r.state], STATE_WORD[r.state], 'e', 1] })
    r.who.slice(0, 5).forEach((w, k) => out.push({ r: [4 + k * 2, +(y + 0.8).toFixed(1), 1, 1, colors[w] ?? DIM] }))
  })
  return out
}
