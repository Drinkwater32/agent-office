// The usage guard and readout. Pure functions only: register.tsx reads the rate-limit windows and the context window
// (session.measure, $.session.usage()), keeps what this decides in the plugin's store, and does the prompting and the
// drawing.
//
// The guard: when a window passes `warnAt` (90% by default), once per window cycle (its kind and reset time), Claude
// is asked to rewrite the one handoff file; when one passes `closeAt` (98%), or the API rejects a turn for the rate
// limit, the office closes until the window resets. It opens again when that time passes or the window reads under
// 50% again. The readout shows the 5-hour window and the context window, colored by the same thresholds.

import { clockText, whenText } from './clock'

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Thresholds = { warnAt: number; closeAt: number }
export type Closed = { kind: string; key: string; until?: number; at: number; why: 'limit' | 'error' }
export type UsageMem = {
  warned: string[]          // the window cycles already warned (kind|resetsAt), newest last
  asked?: number            // when Claude was last asked for the handoff
  saved?: number            // when the handoff was seen saved after that (the file's time, or Claude's reply)
  closed?: Closed
  reopened?: number         // when the office last opened again: the chat's hint says so until the user speaks
  last: Limit[]             // the last reading, for the readout and /office-usage
}

export const REOPEN_UNDER = 50
export const AMBER_UNDER_WARN = 15
export const EMPTY_MEM: UsageMem = { warned: [], last: [] }

const KIND = /^[a-z0-9_]{1,32}$/
const pctOk = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1000

/** The windows as the engine reported them, checked: a kind, a percentage, a reset time that parses. */
export function cleanLimits(v: unknown): Limit[] {
  if (!Array.isArray(v)) return []
  const out: Limit[] = []
  for (const l of v.slice(0, 8)) {
    if (!l || typeof l !== 'object') continue
    const { kind, percentUsed, resetsAt } = l as Record<string, unknown>
    if (typeof kind !== 'string' || !KIND.test(kind) || !pctOk(percentUsed)) continue
    const r = typeof resetsAt === 'string' && resetsAt.length <= 40 && Number.isFinite(Date.parse(resetsAt)) ? resetsAt : undefined
    out.push(r ? { kind, percentUsed, resetsAt: r } : { kind, percentUsed })
  }
  return out
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined)
/** What the store kept, checked: anything malformed is dropped, never trusted. */
export function cleanMem(v: unknown): UsageMem {
  const o = v && typeof v === 'object' ? v as Record<string, unknown> : {}
  const warned = Array.isArray(o.warned) ? o.warned.filter((k): k is string => typeof k === 'string' && k.length <= 80).slice(-8) : []
  const mem: UsageMem = { warned, last: cleanLimits(o.last) }
  if (num(o.asked)) mem.asked = num(o.asked)
  if (num(o.saved)) mem.saved = num(o.saved)
  if (num(o.reopened)) mem.reopened = num(o.reopened)
  const c = o.closed && typeof o.closed === 'object' ? o.closed as Record<string, unknown> : undefined
  if (c && typeof c.kind === 'string' && c.kind.length <= 32 && typeof c.key === 'string' && c.key.length <= 80 && num(c.at) &&
    (c.why === 'limit' || c.why === 'error')) {
    mem.closed = { kind: c.kind, key: c.key, at: num(c.at)!, why: c.why, ...(num(c.until) ? { until: num(c.until) } : {}) }
  }
  return mem
}

export const cycleKey = (l: Limit) => `${l.kind}|${l.resetsAt ?? ''}`
const resetOf = (l: Limit) => (l.resetsAt ? Date.parse(l.resetsAt) : undefined)

// the windows that still count: one whose reset time has passed is an old reading, whatever it said
export const live = (limits: Limit[], now: number) => limits.filter(l => { const r = resetOf(l); return r === undefined || r > now })
export const top = (limits: Limit[], now: number): Limit | undefined =>
  live(limits, now).reduce<Limit | undefined>((a, l) => (!a || l.percentUsed > a.percentUsed ? l : a), undefined)

export const isSaved = (m: UsageMem) => !!(m.asked && m.saved && m.saved >= m.asked)

export type Step = { mem: UsageMem; warn?: Limit; close?: Limit; reopen?: boolean }

/**
 * One reading of the windows (or none, on the poll: `limits` undefined keeps the last) against what was decided before.
 * Opening again comes first (the reset time passed, or the closing window reads under 50%), then closing, then the
 * warning. A close that was never warned warns too (so the handoff is asked for); no warning goes out while closed.
 */
export function step(prev: UsageMem, cfg: Thresholds, limits: Limit[] | undefined, now: number): Step {
  const mem: UsageMem = { ...prev, warned: [...prev.warned], last: limits ?? prev.last }
  const out: Step = { mem }
  const now1 = live(mem.last, now)
  if (mem.closed) {
    const c = mem.closed
    const same = now1.find(l => l.kind === c.kind)
    const passed = c.until !== undefined && now >= c.until
    const under = !!limits && !!same && same.percentUsed < REOPEN_UNDER
    if (passed || under) {
      delete mem.closed
      mem.reopened = now
      out.reopen = true
    }
  }
  if (!limits) return out                       // the poll only opens; a reading decides the rest
  if (!mem.closed && !out.reopen) {
    const t = top(limits, now)
    if (t && t.percentUsed >= cfg.closeAt) {
      mem.closed = { kind: t.kind, key: cycleKey(t), at: now, why: 'limit', ...(resetOf(t) ? { until: resetOf(t) } : {}) }
      out.close = t
    }
  }
  if (out.close || !mem.closed) {
    const due = now1.filter(l => l.percentUsed >= cfg.warnAt && !mem.warned.includes(cycleKey(l)))
      .sort((a, b) => b.percentUsed - a.percentUsed)
    if (due.length) {
      out.warn = due[0]
      for (const l of due) mem.warned.push(cycleKey(l))
      mem.warned = mem.warned.slice(-8)
      mem.asked = now
      delete mem.saved
    }
  }
  return out
}

/** The API said the account hit its rate limit: closed until the busiest window resets (or a turn answers again). */
export function closeForError(prev: UsageMem, now: number): Step {
  const mem: UsageMem = { ...prev, warned: [...prev.warned] }
  if (mem.closed) return { mem }
  const t = top(mem.last, now)
  const until = t ? resetOf(t) : undefined
  mem.closed = { kind: t?.kind ?? 'limit', key: t ? cycleKey(t) : 'error', at: now, why: 'error', ...(until ? { until } : {}) }
  return { mem, close: t ?? { kind: 'limit', percentUsed: 100 } }
}

/** A main-session turn answered: an office closed on an API error opens again (the limit is evidently back). */
export function answered(prev: UsageMem, now: number): Step {
  if (!prev.closed || prev.closed.why !== 'error') return { mem: prev }
  const mem: UsageMem = { ...prev, reopened: now }
  delete mem.closed
  return { mem, reopen: true }
}

// -- words
export const kindLabel = (k: string) => (k === 'five_hour' ? '5-hour' : k === 'seven_day' ? '7-day' : k === 'spend_limit' ? 'spend'
  : k.replace(/_/g, ' ').slice(0, 20))
export const pctLabel = (n: number) => `${Math.floor(n)}%`

/** The prompt that asks Claude for the handoff: the whole file rewritten, never appended to. */
export function handoffPrompt(l: Limit, now: number, file: string, path: string): string {
  const r = resetOf(l)
  return `[Office] Usage is at ${pctLabel(l.percentUsed)} of the ${kindLabel(l.kind)} limit${r ? ` (resets ${whenText(r, now)})` : ''}. ` +
    `REWRITE the handoff file \`${file}\` (${path}) from scratch with the current state: replace the whole file, never ` +
    "append to it, and don't make a new dated copy. Cover what is running (agents, branches), what's done, what's next, " +
    "and anything that needs the user. Then reply 'Handoff saved.'"
}
export const HANDOFF_REPLY = /\bhandoff saved\b/i

// -- the readout: the 5-hour window (else the busiest one) with its reset time, and this session's context window. Red
// from the warning, amber from 15 points under it.
export type Level = 'ok' | 'amber' | 'red'
export const levelOf = (pct: number, cfg: Thresholds): Level =>
  pct >= cfg.warnAt ? 'red' : pct >= cfg.warnAt - AMBER_UNDER_WARN ? 'amber' : 'ok'
export const ctxOk = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100
export type Reading = { pct: number; level: Level }
export type Readout = { main: (Reading & { label: string; resets: string }) | null; ctx: Reading | null }

export function readout(m: UsageMem, cfg: Thresholds, ctx: number | null | undefined, now: number): Readout {
  const l = live(m.last, now)
  const r = (p: number): Reading => {
    const pct = Math.floor(Math.min(100, Math.max(0, p)))
    return { pct, level: levelOf(pct, cfg) }
  }
  const main = l.find(x => x.kind === 'five_hour') ?? top(l, now)
  return {
    main: main ? { ...r(main.percentUsed), label: kindLabel(main.kind), resets: main.resetsAt ? clockText(Date.parse(main.resetsAt)) : '' } : null,
    ctx: ctxOk(ctx) ? r(ctx) : null,
  }
}
/** The readout as one line, for the pane: "5-hour 62% · resets 3:40 PM · context 31%". */
export function readoutLine(ro: Readout): string {
  return [ro.main ? `${ro.main.label} ${ro.main.pct}%` : '5-hour –', ro.main?.resets ? `resets ${ro.main.resets}` : '',
    ro.ctx ? `context ${ro.ctx.pct}%` : ''].filter(Boolean).join(' · ')
}

/** The guard's state for the page: the warning notice, the closed sign. Numbers and clock times only. */
export type UsageView = { pct: number | null; kind: string; warn: boolean; closed: boolean; until: string; reopened: boolean;
  asked: boolean; saved: boolean }
export function view(m: UsageMem, cfg: Thresholds, now: number): UsageView {
  const t = top(m.last, now)
  const c = m.closed
  return {
    pct: t ? Math.floor(Math.min(100, t.percentUsed)) : null,
    kind: t ? kindLabel(t.kind) : '',
    warn: !c && !!t && t.percentUsed >= cfg.warnAt,
    closed: !!c,
    until: c?.until ? clockText(c.until) : '',
    reopened: !c && !!m.reopened,
    asked: !!m.asked,
    saved: isSaved(m),
  }
}

/** /office-usage: the windows, the thresholds, the office's state. */
export function report(m: UsageMem, cfg: Thresholds, handoff: string, ctx: number | null, now: number): string {
  const rows = m.last.map(l => {
    const r = resetOf(l)
    const old = r !== undefined && r <= now
    return `  ${kindLabel(l.kind).padEnd(8)} ${pctLabel(l.percentUsed).padStart(4)} used   ` +
      (old ? 'reset since (an old reading)' : r ? `resets ${whenText(r, now)}` : 'no reset time')
  })
  const c = m.closed
  return [
    rows.length ? 'Usage windows:' : 'No usage windows reported yet (they come with the first reply on a subscription).',
    ...rows,
    ctxOk(ctx) ? `Context window: ${Math.round(ctx)}% full.` : '',
    `Warn at ${cfg.warnAt}%, close at ${cfg.closeAt}%. Handoff file: ${handoff || 'none (no handoff is asked for)'}.`,
    `Office: ${c ? `closed${c.until ? ` until ${whenText(c.until, now)}` : ''}${c.why === 'error' ? ' (the API reported a rate limit)' : ''}` : 'open'}.` +
      (m.asked ? ` Handoff ${isSaved(m) ? 'saved' : 'asked for, not saved yet'}.` : ''),
    'Change them in the config (usage.warnAt, usage.closeAt, usage.handoffFile), then run /office-config.',
  ].filter(Boolean).join('\n')
}
