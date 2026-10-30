import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ChatMsg, MeetingKept, Staffer } from '../types'
import { GIT_READS, GIT_SAFE, boardPrims, boardRows, mergedRead, parseBranches } from './board'
import type { Prim } from './board'
import { clockText, seasonOf } from './clock'
import { EXAMPLE_CONFIG, MAX_FILE_BYTES, deadlineAt, parseConfig, routeAgent, slug } from './config'
import type { OfficeConfig } from './config'
import { eggOf } from './eggs'
import * as M from './meeting'
import { HANDBACK_MS, agentSprites, deptOf, layoutCfg, office, pageCss, pageHtml, plan, setPlan } from './office'
import * as U from './usage'
import { firstSentence, hash, json, plain, toolLabel } from './util'

// agent-office: a pixel-art office in a pane beside the chat. Every agent this session starts takes a seat in the
// department its task belongs to and works away, what it last said in a speech bubble and its latest tool on a tag
// at its desk; when it hands back, its report lands in the inbox at the front desk, where Claude sits. The browser
// copy (/office) is the office beside a chat with Claude, served by a local bridge (bridge/bridge.py, on
// 127.0.0.1 only, with a per-session token); it walks everyone about in its own script. Since 0.2: the conference
// room's meetings (/office-meeting, the office_meeting_update tool), the usage readout and guard (/office-usage), the
// whiteboard with the project's branches, day and night and the seasons, the pets' own antics, and a few easter eggs.

const PANE = 'agent-office'
const TITLE = 'Agent Office'
const staff = atom({ plugin: 'agent-office', key: 'staff' } as const, [], { shape: 'staff-1' })
const chat = atom({ plugin: 'agent-office', key: 'chat' } as const, [], { shape: 'chat-1' })
// the bridge's session token and port, kept for the session through a hot reload: the next bridge takes them over
// (waiting a moment for the port), so the browser window's link keeps working
const keep = atom({ plugin: 'agent-office', key: 'keep' } as const, { token: '', port: 0 }, { shape: 'keep-1' })
// the conference room's meeting (the last one stays, for its transcript): checked by hooks/meeting.ts on every read
const meeting = atom({ plugin: 'agent-office', key: 'meeting' } as const, null as MeetingKept, { shape: 'meeting-1' })
const CHAT_KEEP = 50          // messages the window keeps
const CHAT_CHARS = 20_000     // a message's longest text
const POLL_MS = 3_000
const SHOWN_MS = 120_000      // a finished agent stays in the browser copy's data this long, to walk its report over
const DONE = new Set(['completed', 'failed', 'killed'])
const BRIDGE_PORT = 47321     // the bridge's loopback port (one the OS picks when it is taken)
const TOKEN_RE = /^[\w-]{43,128}$/

// -- where things live: the user's config (<config dir>/agent-office/office.config.json) and each session's run
// folder (<config dir>/plugins/data/agent-office/run/<session id>), both outside the plugin's own folder
let configPath = ''
let dataDir = ''
let runDir = ''
let folderName = ''           // the session's project folder's name, for the front desk's header
let isWindows = false
let cfg: OfficeConfig | undefined
let cfgWarnings: string[] = []
let seq = 0                   // agents seen this session, for round-robin routing

async function setup($: EngineInterface): Promise<void> {
  if (runDir) return
  const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || ''
  isWindows = (await $.env.get('OS')) === 'Windows_NT' || /^[A-Za-z]:[\\/]/.test(home)
  const configDir = ((await $.env.get('CLAUDE_CONFIG_DIR')) || `${home}/.claude`).replace(/\\/g, '/').replace(/\/+$/, '')
  configPath = `${configDir}/agent-office/office.config.json`
  dataDir = `${configDir}/plugins/data/agent-office`
  const sessionId = await $.session.id()
  runDir = `${dataDir}/run/${sessionId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'session'}`
  const root = await $.session.root().catch(() => '')
  projectRoot = root.replace(/\\/g, '/').replace(/\/+$/, '')
  folderName = (root.split(/[\\/]/).filter(Boolean).pop() ?? '').slice(0, 80)
  if (!cfg) await loadConfig($)
}
let projectRoot = ''          // the session's project folder: the whiteboard's git repo, the handoff file's home

/** Reads the config file (a missing one is the defaults) and lays the floor plan out from it. */
async function loadConfig($: EngineInterface): Promise<void> {
  let text: string | undefined
  try {
    const st = await $.fs.stat(configPath)
    text = st.size > MAX_FILE_BYTES ? 'x'.repeat(MAX_FILE_BYTES + 1) : await $.fs.read(configPath)
  } catch {
    text = undefined                                  // no file: the defaults
  }
  const r = parseConfig(text)
  cfg = r.config
  cfgWarnings = r.warnings
  const p = setPlan(cfg)
  if (p.dropped) cfgWarnings.push(`${p.dropped} of the staff did not fit in the departments' rooms and stay home.`)
  seq = (await read($, staff)).length
}

// -- the browser copy: office.html is the office drawn once, beside the front desk's chat, with its style sheet
// (office.css), the walking engine (popout/engine.js) and the chat's script (popout/frontdesk.js). Each session
// writes its own copy to its run folder: the page, the floor plan (layout.js), the live list (staff.js, on every
// poll; also the bridge's heartbeat), the agents' sprites (sprites.js, when the cast changes) and the conversation
// (convo.js, when it changes). The list carries the conversation's version, so a page fetches the conversation only
// when it changed. The page never reloads itself, except when it was rebuilt (a script or the config changed).
let pageKey = ''
let spriteKey = ''
let convoKey = ''
let convoVer = ''
let scriptStamp = ''
const SCRIPTS = ['engine.js', 'frontdesk.js', 'meetplay.js', 'conference.js', 'extras.js', 'lofi.js']
let pageSeason = ''           // the season the page was drawn in: a new one rebuilds it (its decor is in the drawing)

// whether a script changed since the page was written (a stat a poll; the page is rebuilt when one did)
async function scriptsChanged($: EngineInterface): Promise<boolean> {
  let stamp = ''
  for (const f of SCRIPTS) stamp += `${(await $.fs.stat(`${$.plugin.root}/popout/${f}`).catch(() => undefined))?.mtimeMs ?? 0},`
  if (stamp === scriptStamp) return false
  const first = !scriptStamp
  scriptStamp = stamp
  return !first
}

async function writePage($: EngineInterface): Promise<string> {
  await setup($)
  const list: Staffer[] = await read($, staff)
  const now: number = await $.clock.now()
  let code = ''
  for (const f of SCRIPTS) {
    try {
      code += await $.fs.read(`${$.plugin.root}/popout/${f}`)
    } catch {
      // without the scripts the page still shows the office, standing still
    }
  }
  await scriptsChanged($)
  const css = pageCss()
  const ver = hash(code + css).toString(36)
  const key = hash(pageHtml([], 0, ver, '') + json(layoutCfg(''))).toString(36)
  await $.fs.write(`${runDir}/layout.js`, `window.__aoCfg = ${json(layoutCfg(key))};\n`)
  await $.fs.write(`${runDir}/office.css`, css)
  await $.fs.write(`${runDir}/office.html`, pageHtml(list, now, ver, folderName))
  pageKey = key
  pageSeason = seasonNow(now)
  spriteKey = ''
  convoKey = ''
  meetKey = ''
  await writeConvo($)
  await writeMeeting($, now)
  await writeStaff($, list, now)
  return `${runDir}/office.html`
}
const seasonNow = (now: number) => (cfg?.seasons === false ? '' : seasonOf(now))

const agentId = (s: Staffer) => 'a' + hash(s.id).toString(36)
const lookKey = (s: Staffer) => 'a' + hash(`${s.id}|${deptOf(s.desk).id}|${deptOf(s.desk).color}`).toString(36)

// the agents on the page: everyone working, and whoever finished lately (they still have a report to walk over)
const shownOf = (list: Staffer[], now: number) =>
  list.filter(s => !s.isDone || (s.endedAt !== undefined && now - s.endedAt < SHOWN_MS))
const castOf = (shown: Staffer[]) => [...new Set(shown.map(lookKey))].sort().join(',')

function staffJs(list: Staffer[], now: number, key: string): string {
  const shown = shownOf(list, now)
  const mins = (s: Staffer) => Math.max(0, Math.round(((s.endedAt ?? now) - s.startedAt) / 60_000))
  const done = list.filter(s => s.isDone)
  const data = {
    key, convo: convoVer, sprites: hash(castOf(shown)).toString(36),
    busy: list.some(s => !s.isDone), inbox: done.length,
    staff: shown.map(s => ({ id: agentId(s), look: lookKey(s), desk: deptOf(s.desk).id, task: s.task.slice(0, 240),
      tool: toolLabel(s.tool), say: plain(s.say ?? ''), done: s.isDone, failed: s.isFailed, mins: mins(s) })),
    recent: done.slice(-6).reverse().map(s => ({ desk: deptOf(s.desk).id, task: s.task.slice(0, 240),
      failed: s.isFailed, mins: mins(s) })),
    // the extras the page's other scripts read: the meeting's version (they fetch meeting.js when it moves), the
    // usage readout and the guard's state (numbers and clock times only), the whiteboard's face
    meet: meetVer,
    usage: U.view(uMem, thresholds(), now),
    readout: U.readout(uMem, thresholds(), ctxPct, now),
    board: boardFace,
  }
  return `window.__aoStaff = ${json(data)};\n`
}

async function writeStaff($: EngineInterface, list: Staffer[], now: number): Promise<void> {
  if (!pageKey) return
  const shown = shownOf(list, now)
  const cast = castOf(shown)
  if (cast !== spriteKey) {
    await $.fs.write(`${runDir}/sprites.js`, `window.__aoSprites && window.__aoSprites(${json(agentSprites(shown, lookKey))});\n`)
    spriteKey = cast
  }
  await $.fs.write(`${runDir}/staff.js`, staffJs(list, now, pageKey))
}

// -- the usage guard and readout (hooks/usage.ts decides). The readings come from session.measure (after each main
// turn, and whenever a window moves a whole point) and $.session.usage(); nothing polls the API. At the config's
// warnAt, once a window cycle, Claude is asked to rewrite the one handoff file; at closeAt, or when the API refuses a
// turn for the rate limit, the office closes until the window resets. What was decided is kept in the plugin's store
// (`usageMem`), so a reload never repeats a warning. The prompt and the page carry percentages and times only.
let ctxPct: number | null = null
let uMem: U.UsageMem = { ...U.EMPTY_MEM }
let uLoaded = false
let uChain: Promise<unknown> = Promise.resolve()
let uSaving = false
const thresholds = (): U.Thresholds => ({ warnAt: cfg?.usage.warnAt ?? 90, closeAt: cfg?.usage.closeAt ?? 98, extra: cfg?.usage.extra ?? 'auto' })
let costUsd: number | undefined      // overtime: this session's cost so far (/cost's), for /office-usage's line
async function usageLoad($: EngineInterface): Promise<void> {
  if (uLoaded) return
  uMem = U.cleanMem(await $.store.get('usageMem').catch(() => undefined))
  uLoaded = true
}
// the handoff file: the config's, relative to the project's folder unless it is absolute; '' for none
function handoffPath(): string {
  const f = (cfg?.usage.handoffFile ?? '').replace(/\\/g, '/')
  if (!f) return ''
  return /^([A-Za-z]:\/|\/)/.test(f) ? f : `${projectRoot || '.'}/${f.replace(/^(\.\/)+/, '')}`
}
// one decision at a time (a reading, the poll, an error, a reply): load, decide, keep, act
function usageRun($: EngineInterface, decide: (m: U.UsageMem, now: number) => U.Step): Promise<void> {
  const run = uChain.then(async () => {
    await usageLoad($)
    const now: number = await $.clock.now()
    const before = JSON.stringify(uMem)
    const s = decide(uMem, now)
    uMem = s.mem
    if (JSON.stringify(uMem) !== before) await $.store.set('usageMem', uMem).catch(() => undefined)
    await usageAct($, s, now)
  })
  uChain = run.catch(() => undefined)
  return run
}
async function usageAct($: EngineInterface, s: U.Step, now: number): Promise<void> {
  if (!s.warn && !s.close && !s.reopen && !s.overtime && !s.overEnd) return
  if (s.overtime) {                 // past the limit on extra usage: the office stays open, in overtime
    const till = uMem.over?.until ? ` until ${clockText(uMem.over.until)}` : ''
    void $.ui.toast(`Overtime: past the ${U.kindLabel(s.overtime.kind)} limit on extra usage${till}.`)
  }
  if (s.reopen) void $.ui.toast('The office is open again.')
  if (s.close) {
    const until = uMem.closed?.until ? ` until ${clockText(uMem.closed.until)}` : ''
    void $.ui.toast(`The office is closed${until}: usage ${s.close.percentUsed >= 100 ? 'limit reached' : `at ${U.pctLabel(s.close.percentUsed)}`}.`)
  }
  if (s.warn) {                     // a turn of its own, once Claude is idle (queued behind a running turn)
    const path = handoffPath()
    if (path) {
      void $.prompt.submit({ text: U.handoffPrompt(s.warn, now, cfg?.usage.handoffFile ?? '', path) }).catch(() => {
        void $.ui.toast('The office could not ask Claude for the handoff. Ask for it yourself.')
      })
    } else if (!s.close) void $.ui.toast(`Usage at ${U.pctLabel(s.warn.percentUsed)} of the ${U.kindLabel(s.warn.kind)} limit.`)
  }
  await pushOffice($, now)
}
// the handoff was asked for: saved once the file is newer than the ask (or Claude says so)
async function usageSaved($: EngineInterface, by?: 'reply'): Promise<void> {
  if (uSaving || !uMem.asked || U.isSaved(uMem)) return
  uSaving = true
  try {
    let at = 0
    if (by === 'reply') at = await $.clock.now()
    else {
      const path = handoffPath()
      const st = path ? await $.fs.stat(path).catch(() => undefined) : undefined
      if (st && st.mtimeMs >= uMem.asked) at = st.mtimeMs
    }
    if (at) await usageRun($, m => ({ mem: { ...m, saved: Math.max(at, m.asked ?? at) } }))
  } finally {
    uSaving = false
  }
}
// the context window's fill, as a reading gave it (the pane redraws when it moves)
async function ctxSeen($: EngineInterface, pct: unknown): Promise<void> {
  if (!U.ctxOk(pct)) return
  const n = Math.round(pct)
  if (n === ctxPct) return
  ctxPct = n
  await update($, staff, l => [...l])
}
// what the page shows of it moved: the live list now, so open pages read it at once
async function pushOffice($: EngineInterface, now: number): Promise<void> {
  if (!pageKey) return
  await writeStaff($, await read($, staff), now).catch(err => writeFailed($, err))
}

// -- the conference room (hooks/meeting.ts checks everything): the meeting lives in the session's state, written by
// the office_meeting_update tool or a call (/office-meeting, the office's "Call a meeting"). The page reads the run
// folder's meeting.js when the live list says its version moved: the attendees walk to the conference room, the
// speaker's words show in a bubble, the screen and the front desk's Meeting tab fill in.
let meetKey = ''
let meetVer = ''
let calling = false
/** Who can attend, from the config: the departments and the staff at their desks, each with an id of its name. */
function meetCtx(): M.MeetCtx {
  const c = cfg ?? parseConfig(undefined).config
  const used = new Set(['claude', 'owner', 'chair', 'you'])
  const uniq = (k: string) => {
    let key = k
    for (let n = 2; used.has(key); n++) key = `${k.slice(0, 21)}-${n}`
    used.add(key)
    return key
  }
  let unnamed = 0
  return {
    owner: c.owner.name,
    depts: plan().depts.map((d, i) => ({ id: d.id, key: uniq(slug(d.name) || `dept-${i + 1}`), name: d.name, color: d.color })),
    staff: plan().crew.map(s => {
      const n = s.name ? '' : String(++unnamed)
      return { id: s.id, key: uniq(s.name ? slug(s.name) || `teammate-${n}` : `teammate-${n}`), name: s.name || `Teammate ${n}`, dept: s.dept.id }
    }),
  }
}
async function readMeet($: EngineInterface): Promise<M.Meeting | undefined> {
  const v = await read($, meeting).catch(() => null)
  return v ? M.cleanMeeting(v, meetCtx()) : undefined
}
async function keepMeet($: EngineInterface, m: M.Meeting): Promise<void> {
  await update($, meeting, () => JSON.parse(JSON.stringify(m)) as MeetingKept)
}
// the page's copy (meeting.js), when it changed: the live list carries its version
async function writeMeeting($: EngineInterface, now: number): Promise<void> {
  if (!pageKey) return
  const view = M.meetingView(await readMeet($), now, meetCtx())
  const j = json(view)
  const k = hash(j).toString(36)
  if (k === meetKey) return
  await $.fs.write(`${runDir}/meeting.js`, `window.__aoMeeting = ${j};\n`)
  meetKey = k
  meetVer = view ? k : ''
}
async function meetingChanged($: EngineInterface, now: number): Promise<void> {
  await writeMeeting($, now).catch(err => writeFailed($, err))
  await pushOffice($, now)
}
async function meetingUpdate($: EngineInterface, args: Record<string, unknown>): Promise<string> {
  await setup($)
  const now: number = await $.clock.now()
  const r = M.mergeMeeting(await readMeet($), args, meetCtx(), now)
  await keepMeet($, r.meeting)
  await meetingChanged($, now)
  return M.mergeReport(r)
}
// a meeting called: one at a time; the topic is the user's words, capped and kept as one line of text. The meeting
// is "scheduled", and Claude gets the protocol's prompt (queued behind a running turn).
async function callMeetingNow($: EngineInterface, topic: unknown): Promise<string> {
  if (calling) return 'A meeting is being called right now.'
  calling = true
  try {
    await setup($)
    const now: number = await $.clock.now()
    const ctx = meetCtx()
    const r = M.callMeeting(await readMeet($), topic, ctx, now)
    if ('busy' in r) return r.busy
    await keepMeet($, r.meeting)
    await meetingChanged($, now)
    void $.prompt.submit({ text: M.meetPrompt(r.meeting.title, ctx) }).catch(() => {
      void $.ui.toast('The meeting could not reach Claude. Ask Claude to run it.')
    })
    return `Meeting called: "${r.meeting.title}". Claude runs it in the conference room (after the current task, if busy). ` +
      "Watch it in the office's browser window (/office): the Meeting tab at the front desk."
  } finally {
    calling = false
  }
}

// -- the whiteboard: the project's branches (read-only git, never through a shell, once a minute while a page is
// open) and the config's countdown
let boardFace: Prim[] = []
let boardAt = 0
let boardBusy = false
async function gitRun($: EngineInterface, args: string[]): Promise<string | undefined> {
  if (!projectRoot) return undefined
  try {
    const r = await $.process.run(['git', '-C', projectRoot, ...GIT_SAFE, ...args], { timeoutMs: 15_000 })
    return r.exitCode === 0 ? r.stdout.slice(0, 200_000) : undefined
  } catch {
    return undefined
  }
}
async function refreshBoard($: EngineInterface, now: number, force = false): Promise<void> {
  if (boardBusy || (!force && now - boardAt < 60_000)) return
  boardBusy = true
  boardAt = now
  try {
    const outs: (string | undefined)[] = []
    for (const a of GIT_READS) outs.push(await gitRun($, a))
    const b = parseBranches(outs)
    const mr = b?.base ? mergedRead(b.base) : undefined
    const merged = mr ? await gitRun($, mr) : undefined
    const list: Staffer[] = await read($, staff)
    const { rows, why } = boardRows(b, merged, list.map(s => ({ task: s.task, desk: deptOf(s.desk).id, done: s.isDone })), now)
    const colors: Record<string, string> = { claude: M.CHAIR_COLOR }
    for (const d of plan().depts) colors[d.id] = d.color
    const dl = cfg?.deadline ? { label: cfg.deadline.label, at: deadlineAt(cfg.deadline) } : undefined
    boardFace = boardPrims(rows, why, dl, now, colors)
  } finally {
    boardBusy = false
  }
}

// -- the conversation: what the window shows of the main session. Whether Claude is mid-turn lives here (a reload
// mid-turn reads idle until the turn's next step says otherwise).
let busy = false
let busySince = 0

function convoJs(msgs: ChatMsg[], now: number, bridgeOn: boolean): string {
  const data = {
    busy, since: busy ? busySince : 0, now, bridge: bridgeOn, bridgeWhy, where: folderName,
    msgs: msgs.map(m => ({ id: m.id, who: m.who, text: m.text, at: m.at, via: m.via ?? '', state: m.state ?? '',
      cid: m.cid ?? '', brief: m.who === 'claude' ? firstSentence(plain(m.text.split(/\n\s*\n/)[0] ?? ''), 80) : '' })),
  }
  return `window.__aoConvo = ${json(data)};\n`
}

async function writeConvo($: EngineInterface): Promise<void> {
  const msgs: ChatMsg[] = await read($, chat)
  const now: number = await $.clock.now()
  const k = `${busy}|${busySince}|${!!bridge}|${bridgeWhy}|` + msgs.map(m => `${m.id}:${m.text.length}:${m.state ?? ''}`).join(',')
  if (k === convoKey || !pageKey) return
  try {
    await $.fs.write(`${runDir}/convo.js`, convoJs(msgs, now, !!bridge))
    convoKey = k
    convoVer = hash(k).toString(36)
    await writeStaff($, await read($, staff), now)     // the list carries the new version: pages fetch it at once
  } catch (err) {
    writeFailed($, err)                             // the next change tries again
  }
}

// a write that failed (a locked or full disk): said once in the transcript, until it works again
let writeErr = ''
function writeFailed($: EngineInterface, err: unknown): void {
  const msg = scrub(String(err instanceof Error ? err.message : err)).slice(0, 200)
  if (msg === writeErr) return
  writeErr = msg
  $.ui.log(`Agent Office: could not write the office's files (${msg}).`)
}

async function addMsg($: EngineInterface, m: Omit<ChatMsg, 'id' | 'at'>): Promise<string> {
  const at: number = await $.clock.now()
  const id = 'm' + hash(`${at}|${m.who}|${m.text.slice(0, 200)}|${Math.random()}`).toString(36)
  await update($, chat, l => [...l, { ...m, text: m.text.slice(0, CHAT_CHARS), id, at }].slice(-CHAT_KEEP))
  await writeConvo($)
  return id
}

// Claude's reply in a turn: each step's visible text joins the turn's one message
async function claudeSaid($: EngineInterface, turn: string, text: string): Promise<void> {
  const l: ChatMsg[] = await read($, chat)
  const cur = l.find(m => m.who === 'claude' && m.turn === turn)
  if (!cur) return void await addMsg($, { who: 'claude', text, turn })
  if (cur.text.endsWith(text)) return
  await update($, chat, x => x.map(m => (m.id === cur.id ? { ...m, text: `${m.text}\n\n${text}`.slice(0, CHAT_CHARS) } : m)))
  await writeConvo($)
}

// -- the bridge: a small local web server (bridge/bridge.py) for the session's life, serving the page and taking the
// messages typed in it, which come out on its stdout as JSON lines and go in as the user's prompts. It ends with the
// loop that reads it (the module unloading kills it), or on its own once the heartbeat file (the run folder's
// staff.js) goes stale. When it ends the 3-second poll starts another: soon at first, every five minutes after five
// quick tries (a run of a minute or more starts the count again). Its stderr goes to a capped log in the data folder.
//
// Paths never go on its command line: it runs as `python -I bridge.py --stdin` from its own folder, and the folders
// it serves come on stdin with the session token, so a space in a path (or a launcher shim that re-splits its
// arguments) can't split anything.
let bridge: { port: number; token: string } | undefined
let bridgeTries = 0
let bridgeRunning = false
let bridgeNextAt = 0
let bridgeWhy = ''                  // why there is no bridge, when it failed to start
let polling = false

// what the bridge writes on stderr, with anything token-shaped taken out, in a log that keeps its last 64 KB
let errLog = ''
let errFlush = false
function scrub(s: string): string {
  let out = s
  if (bridge?.token) out = out.split(bridge.token).join('[redacted]')
  return out.replace(/[A-Za-z0-9_-]{40,}/g, '[redacted]')
}
function logErr($: EngineInterface, text: string): void {
  errLog = (errLog + scrub(text)).slice(-65_536)
  if (errFlush || !dataDir) return
  errFlush = true
  void $.clock.after(2_000, async () => {
    errFlush = false
    await $.fs.write(`${dataDir}/bridge.log`, errLog).catch(() => undefined)
  })
}

const pythons = () => (isWindows ? [['py', '-3'], ['python'], ['python3']] : [['python3'], ['python']])

function startBridge($: EngineInterface): void {
  if (bridgeRunning || !runDir) return
  bridgeRunning = true
  const root = $.plugin.root
  void (async () => {
    const started: number = await $.clock.now()
    let ran = false
    let why = ''
    try {
      const kept = await read($, keep)
      const input = JSON.stringify({ root: runDir, static: `${root}/popout`, heartbeat: `${runDir}/staff.js`,
        session: TOKEN_RE.test(kept.token) ? kept.token : '', port: kept.port || BRIDGE_PORT,
        port_wait: kept.port ? 3 : 0, prune: true }) + '\n'
      logErr($, `\n-- bridge starting ${new Date(started).toISOString()}\n`)
      for (const exe of pythons()) {
        try {
          let buf = ''
          const proc = $.process.spawn({ argv: [...exe, '-I', 'bridge.py', '--stdin'], cwd: `${root}/bridge`, input })
          for await (const piece of proc) {
            if (piece.stream === 'stderr') {
              logErr($, piece.text)
              continue
            }
            buf += piece.text
            for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
              const line = buf.slice(0, i)
              buf = buf.slice(i + 1)
              if (await bridgeLine($, line)) ran = true
            }
          }
        } catch (err) {
          why = `${exe[0]} could not start (${scrub(String(err instanceof Error ? err.message : err)).slice(0, 160)})`
          logErr($, `${why}\n`)
        }
        if (ran) break
      }
    } catch (err) {
      why = scrub(String(err instanceof Error ? err.message : err)).slice(0, 160)
      logErr($, `bridge: ${why}\n`)
    }
    const now: number = await $.clock.now()
    bridge = undefined
    bridgeRunning = false
    if (ran && now - started > 60_000) bridgeTries = 0      // it ran a good while: start counting again
    bridgeTries++
    bridgeNextAt = now + (bridgeTries <= 5 ? 5_000 * bridgeTries : 300_000)
    bridgeWhy = ran ? '' : `The chat bridge did not start (it needs Python 3)${why ? `: ${why}` : ''}. Its log is ${dataDir}/bridge.log.`
    if (!ran) logErr($, `${bridgeWhy}\n`)
    void writeConvo($)
  })()
}

async function bridgeLine($: EngineInterface, line: string): Promise<boolean> {
  let m: { ready?: boolean; port?: number; token?: string; msg?: string; cid?: string; meet?: unknown; call?: unknown }
  try {
    m = JSON.parse(line)
  } catch {
    return false
  }
  if (typeof m !== 'object' || m === null) return false
  if (m.ready && typeof m.port === 'number' && m.port > 0 && m.port < 65536 && typeof m.token === 'string' &&
    TOKEN_RE.test(m.token)) {
    bridge = { port: m.port, token: m.token }
    bridgeWhy = ''
    await update($, keep, () => ({ token: m.token as string, port: m.port as number }))
    await writeConvo($)
    return true
  }
  if (m.call && typeof m.call === 'object') {               // "Call a meeting" in the office (the bridge checked it)
    await callMeetingNow($, (m.call as { topic?: unknown }).topic).catch(() => undefined)
    return true
  }
  if (typeof m.msg === 'string' && m.msg.trim()) {
    const said = m.msg.slice(0, 4096)
    if (eggOf(said)) return true                               // an easter egg's code: the office's own, never Claude's
    let text = said
    if (m.meet === true && M.isLive(await readMeet($), await $.clock.now())) text = M.meetingLine(said, meetCtx())
    const cid = typeof m.cid === 'string' && /^[a-z0-9]{1,24}$/.test(m.cid) ? m.cid : undefined
    usageSpoke($)
    const id = await addMsg($, { who: 'owner', text, via: 'window', state: busy ? 'queued' : 'sent', cid })
    void $.prompt.submit({ text, asUser: true }).catch(async () => {   // never reached Claude: say so in the window
      await update($, chat, l => l.map(x => (x.id === id ? { ...x, state: 'failed' as const } : x)))
      await writeConvo($)
    })
    return true
  }
  return false
}

// -- opening the browser: on Windows through the URL handler (rundll32 url.dll,FileProtocolHandler), which takes the
// whole URL, query string and all, as one argument; `open` on macOS; on Linux `xdg-open`, else `gio open`, else
// `sensible-browser`. Never through a shell. Windows' handler gives no answer either way, so there it counts as opened.
let isMac: boolean | undefined
async function openUrl($: EngineInterface, url: string): Promise<boolean> {
  if (!/^(http:\/\/127\.0\.0\.1:\d{1,5}\/|file:\/\/\/)[^\s"<>]*$/.test(url)) return false
  let tries: string[][]
  if (isWindows) tries = [['rundll32.exe', 'url.dll,FileProtocolHandler', url]]
  else {
    if (isMac === undefined) {
      isMac = await $.process.run(['uname', '-s'], { timeoutMs: 5_000 }).then(r => r.stdout.trim() === 'Darwin').catch(() => false)
    }
    tries = isMac ? [['open', url]] : [['xdg-open', url], ['gio', 'open', url], ['sensible-browser', url]]
  }
  for (const argv of tries) {
    try {
      const r = await $.process.run(argv, { timeoutMs: 15_000 })
      if (isWindows || r.exitCode === 0) return true
    } catch {
      // not on this machine: the next one
    }
  }
  return false
}
// a local file as a file: URL, each part of its path percent-encoded (spaces included)
const fileUrl = (path: string) => 'file:///' + path.replace(/\\/g, '/').replace(/^\/+/, '').split('/')
  .map((p, i) => (i === 0 && /^[A-Za-z]:$/.test(p) ? p : encodeURIComponent(p))).join('/')

/**
 * Opens the browser window: the bridge's page with the chat, else the file copy, read-only. `by` is who asked: the
 * user (/office), Claude (the open_office tool), or the session's start. When no browser opens, the user's command
 * says so and gives the address to open by hand; it carries the session's key (the bridge answers nothing without
 * it), so only the user's own command shows it, never Claude's tool, a log, or the session's start.
 */
async function openPopout($: EngineInterface, by: 'user' | 'tool' | 'start' = 'user'): Promise<string> {
  await setup($)
  const path = await writePage($)
  if (!bridgeRunning && !bridge) startBridge($)
  const waits = by === 'start' ? 80 : 30             // a fresh session gives Python longer to start
  for (let i = 0; i < waits && !bridge; i++) await new Promise<void>(r => void $.clock.after(150, () => r()))
  if (bridge) {
    const url = `http://127.0.0.1:${bridge.port}/office.html?k=${bridge.token}`
    if (await openUrl($, url)) return `The office is open in your browser, with the chat (local bridge on 127.0.0.1:${bridge.port}).`
    if (by === 'user') {
      return 'No browser window opened on this machine. Open this address in a browser on this computer:\n\n' +
        `  ${url}\n\nIt holds this session's private key (the part after k=): the office's local server answers nothing ` +
        'without it, so no other web page or program can use it. It stops working when this session ends. Do not share it.'
    }
    return 'No browser window opened on this machine. Run /office to get the address to open by hand.'
  }
  const ok = await openUrl($, fileUrl(path))
  return `The office is ${ok ? 'open in your browser' : 'written'}, read-only (${bridgeWhy || 'the chat bridge did not start'}): ${path}`
}

/** /office-config: writes a starter file when there is none, reads it again, and says what it holds. */
async function configText($: EngineInterface): Promise<string> {
  await setup($)
  let made = false
  const exists = await $.fs.stat(configPath).then(() => true).catch(() => false)
  if (!exists) {
    await $.fs.write(configPath, JSON.stringify(EXAMPLE_CONFIG, null, 2) + '\n')
    made = true
  }
  await loadConfig($)
  pageKey = ''                                       // the page is rebuilt on the next poll, and open pages reload
  await update($, staff, l => [...l])                // the pane draws the new plan
  const c = cfg!
  const lines = [
    `${made ? 'Wrote a starter config' : 'Read the config'}: ${configPath}`,
    `Owner: ${c.owner.name}`,
    `Departments (${c.routing}): ${c.departments.map(d => d.name).join(', ')}`,
    `Staff: ${c.staff.length ? c.staff.map(s => s.name || 'unnamed').join(', ') : 'none'}`,
    `Pets: ${c.pets.length ? c.pets.map(p => `${p.name} (${p.coat}, ${p.color})`).join(', ') : 'none'}`,
    `Usage: warn at ${c.usage.warnAt}%, close at ${c.usage.closeAt}%; handoff file ${c.usage.handoffFile ? handoffPath() : 'none'}`,
    `Whiteboard countdown: ${c.deadline ? `${c.deadline.label}, ${c.deadline.y}-${String(c.deadline.mo).padStart(2, '0')}-` +
      `${String(c.deadline.d).padStart(2, '0')} ${clockText(deadlineAt(c.deadline))}` : 'none'}`,
    `Seasonal decor: ${c.seasons ? 'on' : 'off'}`,
    `Soundtrack toggle: ${c.soundtrack.enabled ? 'shown (it starts off)' : 'hidden'}`,
    `Opens in your browser as a session starts: ${c.openOnStart ? 'yes' : 'no'}`,
  ]
  if (cfgWarnings.length) lines.push('', 'Warnings:', ...cfgWarnings.map(w => `- ${w}`))
  lines.push('', 'Edit the file and run /office-config again to apply it.')
  return lines.join('\n')
}

// the tool Claude runs a meeting with: its description names who can attend, from the config at the session's start
function meetingTool() {
  const ctx = meetCtx()
  const ids = M.attendeeIds(ctx)
  const depts = ctx.depts.map(d => `"${d.key}" (${d.name})`).join(', ')
  const named = ctx.staff.filter(s => !s.key.startsWith('teammate-')).map(s => `"${s.key}"`).join(', ')
  const deptWords = `"chair", "owner", or a department: ${ctx.depts.map(d => `"${d.key}"`).join(', ')}`
  return {
    name: 'office_meeting_update',
    description: "Runs a meeting in the office's conference room, which the user watches live (the attendees walk in " +
      "and sit, the speaker's words show in a bubble, the transcript fills in). Leave id out to update the current " +
      'meeting (the one the user called); a new id starts a new one. title, status, agenda and attendees replace what ' +
      `was there; turn appends one turn. The owner ("owner", ${ctx.owner}) and Claude as the chair ("claude") always ` +
      `attend; list up to ${M.OTHERS_MAX} more: departments ${depts || '(none)'}${named ? `, staff ${named}` : ''}. ` +
      'Statuses: scheduled, gathering (they walk in), in_session (proposals), discussion, wrap_up (decisions), ended ' +
      "(they walk out; the decisions stay on the screen). Keep each turn's text short: it is read in a bubble. Turns " +
      'are animated in the room at a reading pace, so it is fine to send them quickly, one after another. Never ' +
      "put words in the owner's mouth.",
    inputSchema: { type: 'object', properties: {
      id: { type: 'string', description: "The meeting's id (letters, digits, - or _): leave out to update the current one" },
      title: { type: 'string', description: "The meeting's title, at most 120 characters" },
      status: { type: 'string', enum: [...M.STATUSES] },
      agenda: { type: 'array', maxItems: M.AGENDA_MAX, description: "Replaces the agenda: one item per department's proposal",
        items: { type: 'object', properties: { dept: { type: 'string', description: deptWords },
          title: { type: 'string', description: 'At most 120 characters' } }, required: ['dept', 'title'] } },
      attendees: { type: 'array', maxItems: M.OTHERS_MAX + 2, description: 'Replaces the attendees (the owner and Claude stay regardless)',
        items: { type: 'object', properties: { id: { type: 'string', description: `One of: ${ids.map(x => x.id).join(', ')}` },
          name: { type: 'string', description: 'At most 24 characters' }, dept: { type: 'string', description: deptWords },
          role: { type: 'string', description: 'At most 40 characters' } }, required: ['id'] } },
      turn: { type: 'object', description: 'One turn, appended to the transcript', properties: {
        speaker_id: { type: 'string', description: "An attendee's id" }, kind: { type: 'string', enum: [...M.KINDS] },
        text: { type: 'string', description: `What they say, at most ${M.TEXT_MAX} characters` },
        title: { type: 'string', description: "A proposal's title (shown on the screen), at most 120 characters" } },
      required: ['speaker_id', 'kind', 'text'] },
    } },
  }
}
// the user said something after the office opened again: its "open again" note has done its job
function usageSpoke($: EngineInterface): void {
  if (uMem.reopened) void usageRun($, m => { const mem = { ...m }; delete mem.reopened; return { mem } }).catch(() => undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'office', description: 'Open the agent office in your browser, with a chat to Claude' })
    await $.command.register({ name: 'office-pane', description: 'Open the office in a pane beside the chat instead' })
    await $.command.register({ name: 'office-config', description: "Create, show or reload the office's config" })
    await $.command.register({ name: 'office-meeting', description: 'Call a meeting in the office\'s conference room (topic optional)' })
    await $.command.register({ name: 'office-usage', description: 'Usage windows, and when the office warns and closes' })
    await $.tool.register({ name: 'open_office', description: 'Opens the agent office in a browser window, with a chat ' +
      'to Claude at its front desk. Call it when the user asks to open the office.' })
    await setup($)
    await $.tool.register(meetingTool())
    // the browser window is the office: it opens as a session starts (with a person at the prompt, the config not
    // saying otherwise), once a session, not again on a hot reload (the kept token says the bridge already ran)
    const reloaded = TOKEN_RE.test((await read($, keep)).token)
    if (e.isInteractive && cfg?.openOnStart !== false && !reloaded) void openPopout($, 'start').catch(() => undefined)
    $.clock.every(POLL_MS, async () => {
      const now = await $.clock.now()
      const live = await $.agent.list()
      const byId = new Map(live.map(a => [a.id, a]))
      const held = await read($, staff)
      let changed = false
      const next1 = held.map(s => {
        if (s.isDone) return s
        const info = byId.get(s.id)
        if (info && !DONE.has(info.status)) return s
        changed = true
        void $.clock.after(HANDBACK_MS + 200, () => update($, staff, l => [...l]))  // Claude walks back
        return { ...s, isDone: true, isFailed: info?.status === 'failed', endedAt: now }
      })
      for (const a of live) {                      // agents started before the office opened
        if (DONE.has(a.status) || held.some(s => s.id === a.id) || a.id.startsWith('wf')) continue
        changed = true
        next1.push({ id: a.id, task: a.description, desk: `d${routeAgent(cfg!, { type: a.type, text: a.description }, seq++)}`,
          isDone: false, isFailed: false, startedAt: now })
      }
      if (changed) await update($, staff, () => next1.slice(-60))   // only a real change redraws the pane
      if (polling) return                          // the last poll's slow part is still going
      polling = true
      try {
        // the usage guard: a closed office opens once its reset time passes; a handoff asked for, saved yet?
        await usageRun($, (m, t) => U.step(m, thresholds(), undefined, t)).catch(() => undefined)
        await usageSaved($).catch(() => undefined)
        try {                                      // the browser copy (staff.js is the bridge's heartbeat too)
          if (pageKey && await scriptsChanged($)) pageKey = ''      // a script changed: rebuild, and pages reload
          if (pageKey && seasonNow(now) !== pageSeason) pageKey = ''  // a new season's decor: rebuild
          if (!pageKey) await writePage($)
          else {
            await refreshBoard($, now)
            await writeMeeting($, now)
            await writeStaff($, await read($, staff), now)
          }
          writeErr = ''
        } catch (err) {
          writeFailed($, err)                      // the next poll tries again
        }
        if (!bridgeRunning && now >= bridgeNextAt) startBridge($)
        await writeConvo($)
      } finally {
        polling = false
      }
    })
    startBridge($)
    const u = await $.session.usage().catch(() => undefined)      // a reload keeps the readout where it was
    if (u) {
      await ctxSeen($, u.context?.percent).catch(() => undefined)
      await usageRun($, (m, t) => U.step(m, thresholds(), U.cleanLimits(u.rateLimits), t)).catch(() => undefined)
    }
    return next(e)
  })

  // The usage guard's readings: after each main-session turn, and whenever a window moves a whole point
  on('session.measure', async ($, e, next) => {
    try {
      await setup($)
      await ctxSeen($, e.context?.percent)
      if (typeof e.cost?.usd === 'number' && Number.isFinite(e.cost.usd)) costUsd = e.cost.usd
      await usageRun($, (m, t) => U.step(m, thresholds(), U.cleanLimits(e.rateLimits), t))
      await usageSaved($)
      await pushOffice($, await $.clock.now())    // the page's readout moves with this reading
    } catch {
      // the guard never stands in the engine's way
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The API refused a turn for the rate limit: the office closes now, whatever the last reading said
  on('classic.StopFailure', async ($, e, next) => {
    if (e.error === 'rate_limit') await usageRun($, (m, t) => U.closeForError(m, t)).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e))   // only watching: a failure never touches the stop

  on('command.run', { command: 'office-usage' }, async $ => {
    await setup($)
    const u = await $.session.usage().catch(() => undefined)
    if (u) await ctxSeen($, u.context?.percent).catch(() => undefined)
    await usageRun($, (m, t) => U.step(m, thresholds(), u ? U.cleanLimits(u.rateLimits) : undefined, t)).catch(() => undefined)
    const now: number = await $.clock.now()
    if (typeof u?.cost?.usd === 'number' && Number.isFinite(u.cost.usd)) costUsd = u.cost.usd
    return { text: U.report(uMem, thresholds(), handoffPath(), ctxPct, now, costUsd) }
  })

  // a meeting: called by the user (/office-meeting [topic]; the office's button comes through the bridge), run by
  // Claude through the tool
  on('command.run', { command: 'office-meeting' }, async ($, e) => ({ text: await callMeetingNow($, e.args) }))
  on('tool.call', { tool: 'mcp__agent-office__office_meeting_update' }, async ($, e) => {
    const { tool: _t, tool_use_id: _u, agentId: _a, ...args } = e as unknown as Record<string, unknown>
    return { result: await meetingUpdate($, args) }
  }).catch(() => ({ result: 'The meeting could not be updated.' }))

  on('command.run', { command: 'office' }, async $ => ({ text: await openPopout($, 'user') }))
  on('command.run', { command: 'office-config' }, async $ => ({ text: await configText($) }))
  on('command.run', { command: 'office-pane' }, async $ => {
    const r = await $.ui.open({ id: PANE, title: TITLE })
    return { text: r.isPlaced ? 'The office is open in a pane beside the chat.'
      : 'The office pane is open, but this surface shows no panes. /office opens it in your browser.' }
  })
  // "open the office": Claude calls this tool, which opens the same window /office does
  on('tool.call', { tool: 'mcp__agent-office__open_office' }, async $ => ({ result: await openPopout($, 'tool') }))
    .catch(() => ({ result: 'The office could not open. Try /office.' }))

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if ('agentId' in started && started.agentId) {
      await setup($)
      const now = await $.clock.now()
      const id = started.agentId
      const desk = `d${routeAgent(cfg!, { type: e.subagentType, text: `${e.description} ${e.prompt.slice(0, 600)}` }, seq)}`
      seq++
      await update($, staff, list => list.some(s => s.id === id) ? list : [...list, {
        id, task: e.description, desk, isDone: false, isFailed: false, startedAt: now,
      }].slice(-60))
    }
    return started
  }).catch(($, e, next) => next(e))   // only watching: a failure never stops a spawn

  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (id) {
      const list = await read($, staff)
      const s = list.find(x => x.id === id)
      if (s && !s.isDone && s.tool !== e.tool) {
        await update($, staff, l => l.map(x => (x.id === id ? { ...x, tool: e.tool } : x)))
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))   // only watching: a failure never stops a tool call

  // The user's own prompts, typed in the terminal, for the window's conversation. Ones the window sent come back
  // through the bridge and never reach this hook (a plugin's own submit skips its hooks).
  on('prompt.submit', async ($, e, next) => {
    const r = await next(e)
    const kind = e.origin.kind
    if (!r.drop && !e.command && !e.isMeta && (kind === 'composer' || kind === 'bridge') && e.text.trim()) {
      await addMsg($, { who: 'owner', text: e.text.trim(), via: 'terminal' })
      usageSpoke($)
    }
    return r
  }).catch(($, e, next) => next(e))   // only watching: a failure never stops a prompt

  // Claude at work on the main session: the window shows it typing, and its window message as delivered
  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) {
      busy = true
      busySince = await $.clock.now()
      const text = e.text.trim()
      const l: ChatMsg[] = await read($, chat)
      const q = l.find(m => m.state === 'queued' && m.text.trim() === text)
      if (q) await update($, chat, x => x.map(m => (m.id === q.id ? { ...m, state: 'sent' as const } : m)))
      await writeConvo($)
    }
    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) {
      busy = false
      const l: ChatMsg[] = await read($, chat)
      if (e.answer.trim() && !l.some(m => m.who === 'claude' && m.turn === e.turnId)) {
        await addMsg($, { who: 'claude', text: e.answer.trim(), turn: e.turnId })
      }
      await writeConvo($)
      if (U.HANDOFF_REPLY.test(e.answer)) await usageSaved($, 'reply').catch(() => undefined)
      await usageRun($, (m, t) => U.answered(m, t, thresholds(), costUsd)).catch(() => undefined)   // a turn answered: not rate-limited now
    }
    return r
  }).catch(($, e, next) => next(e))

  // What was said: an agent's first sentence, as plain text, for its speech bubble; on the main session, Claude's
  // reply for the window. The step streams, so the hook passes every piece through untouched and reads the whole
  // answer at the end.
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    const id = e.agentId
    const answer = (r.answer ?? '').trim()
    if (id && answer) {
      const line = firstSentence(plain(answer))
      const cur = (await read($, staff)).find(x => x.id === id)
      if (line && cur && !cur.isDone && cur.say !== line) {
        await update($, staff, l => l.map(x => (x.id === id && !x.isDone ? { ...x, say: line } : x)))
      }
    } else if (id === undefined) {
      if (!busy) {
        busy = true
        busySince = await $.clock.now()
      }
      if (answer) await claudeSaid($, e.turnId, answer)
      else await writeConvo($)
    }
    return r
  }).catch(async function* ($, e, next) {   // only watching: a failure never stops a turn
    return yield* next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const list = await read($, staff)
    const now = await $.clock.now()
    const working = list.filter(s => !s.isDone)
    const done = list.filter(s => s.isDone)
    const mins = (s: Staffer) => Math.max(0, Math.round(((s.endedAt ?? now) - s.startedAt) / 60_000))
    const label = (d: string) => deptOf(d).name.slice(0, 12)
    // always first: "5-hour 62% · resets 3:40 PM · context 31%", each number colored by its level
    await usageLoad($).catch(() => undefined)
    const ro = U.readout(uMem, thresholds(), ctxPct, now)
    const tone = (r: U.Reading | null) => (r?.level === 'red' ? 'red' : r?.level === 'amber' ? 'yellow' : undefined)
    const shut = uMem.closed ? `Office closed${uMem.closed.until ? ` until ${clockText(uMem.closed.until)}` : ''} · ` : ''
    const gauge = (
      <Text>
        {shut ? <Text color="red">{shut}</Text> : null}
        <Text color={ro.main?.over ? 'yellow' : tone(ro.main)} bold>{ro.main?.over ? `OVERTIME${ro.main.left ? ` ${ro.main.left} left` : ''}`
          : ro.main ? `${ro.main.label} ${ro.main.pct}%` : '5-hour –'}</Text>
        {ro.main?.resets ? <Text dimColor> · resets {ro.main.resets}</Text> : null}
        {ro.ctx ? <Text color={tone(ro.ctx)} dimColor={ro.ctx.level === 'ok'}> · context {ro.ctx.pct}%</Text> : null}
      </Text>
    )
    const rows = (
      <Box flexDirection="column">
        <Text bold>{working.length ? `At their desks (${working.length})` : 'Nobody at a desk right now'}</Text>
        {working.map(s => (
          <Text>
            {label(s.desk).padEnd(12)} {s.task}{s.tool ? ` · ${toolLabel(s.tool)}` : ''} · {mins(s)}m
            {s.say ? <Text dimColor> “{s.say}”</Text> : null}
          </Text>
        ))}
        <Text bold>Inbox: {done.length} handed back</Text>
        {done.slice(-4).reverse().map(s => (
          <Text dimColor>
            {s.isFailed ? 'Failed: ' : 'Handed back: '}{label(s.desk)} · {s.task} · took {mins(s) ? `${mins(s)}m` : 'under 1m'}
          </Text>
        ))}
      </Box>
    )
    if (!('Svg' in els)) {
      return (
        <Box flexDirection="column">
          {gauge}
          {rows}
        </Box>
      )
    }
    const { Svg } = els
    return (
      <Box flexDirection="column">
        {gauge}
        <Svg source={office(list, now)} alt={`The office: ${working.length} agents at their desks, ${done.length} reports in the inbox`} isInteractive />
        {rows}
      </Box>
    )
  })
}
