import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ChatMsg, Staffer } from '../types'
import { EXAMPLE_CONFIG, MAX_FILE_BYTES, parseConfig, routeAgent } from './config'
import type { OfficeConfig } from './config'
import { HANDBACK_MS, agentSprites, deptOf, layoutCfg, office, pageCss, pageHtml, setPlan } from './office'
import { firstSentence, hash, json, plain, toolLabel } from './util'

// agent-office: a pixel-art office in a pane beside the chat. Every agent this session starts takes a seat in the
// department its task belongs to and works away, what it last said in a speech bubble and its latest tool on a tag
// at its desk; when it hands back, its report lands in the inbox at the front desk, where Claude sits. The browser
// copy (/office-popout) is the office beside a chat with Claude, served by a local bridge (bridge/bridge.py, on
// 127.0.0.1 only, with a per-session token); it walks everyone about in its own script.

const PANE = 'agent-office'
const TITLE = 'Agent Office'
const staff = atom({ plugin: 'agent-office', key: 'staff' } as const, [], { shape: 'staff-1' })
const chat = atom({ plugin: 'agent-office', key: 'chat' } as const, [], { shape: 'chat-1' })
// the bridge's session token and port, kept for the session through a hot reload: the next bridge takes them over
// (waiting a moment for the port), so the browser window's link keeps working
const keep = atom({ plugin: 'agent-office', key: 'keep' } as const, { token: '', port: 0 }, { shape: 'keep-1' })
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
  folderName = (root.split(/[\\/]/).filter(Boolean).pop() ?? '').slice(0, 80)
  if (!cfg) await loadConfig($)
}

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
const SCRIPTS = ['engine.js', 'frontdesk.js']

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
  spriteKey = ''
  convoKey = ''
  await writeConvo($)
  await writeStaff($, list, now)
  return `${runDir}/office.html`
}

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
  let m: { ready?: boolean; port?: number; token?: string; msg?: string; cid?: string }
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
  if (typeof m.msg === 'string' && m.msg.trim()) {
    const text = m.msg.slice(0, 4096)
    const cid = typeof m.cid === 'string' && /^[a-z0-9]{1,24}$/.test(m.cid) ? m.cid : undefined
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
// whole URL, query string and all, as one argument; `open` on macOS; `xdg-open` elsewhere. Never through a shell.
let isMac: boolean | undefined
async function openUrl($: EngineInterface, url: string): Promise<boolean> {
  if (!/^(http:\/\/127\.0\.0\.1:\d{1,5}\/|file:\/\/\/)[^\s"<>]*$/.test(url)) return false
  let argv: string[]
  if (isWindows) argv = ['rundll32.exe', 'url.dll,FileProtocolHandler', url]
  else {
    if (isMac === undefined) {
      isMac = await $.process.run(['uname', '-s'], { timeoutMs: 5_000 }).then(r => r.stdout.trim() === 'Darwin').catch(() => false)
    }
    argv = [isMac ? 'open' : 'xdg-open', url]
  }
  try {
    const r = await $.process.run(argv, { timeoutMs: 15_000 })
    return isWindows || r.exitCode === 0
  } catch {
    return false
  }
}
// a local file as a file: URL, each part of its path percent-encoded (spaces included)
const fileUrl = (path: string) => 'file:///' + path.replace(/\\/g, '/').replace(/^\/+/, '').split('/')
  .map((p, i) => (i === 0 && /^[A-Za-z]:$/.test(p) ? p : encodeURIComponent(p))).join('/')

/** Opens the browser window: the bridge's page with the chat, else the file copy, read-only. */
async function openPopout($: EngineInterface): Promise<string> {
  await setup($)
  const path = await writePage($)
  if (!bridgeRunning && !bridge) startBridge($)
  for (let i = 0; i < 30 && !bridge; i++) await new Promise<void>(r => void $.clock.after(150, () => r()))
  if (bridge) {
    // the link carries the session token: it goes to the browser alone, never into this result or a log
    const ok = await openUrl($, `http://127.0.0.1:${bridge.port}/office.html?k=${bridge.token}`)
    return ok ? `The office is open in your browser, with the chat (local bridge on 127.0.0.1:${bridge.port}).`
      : 'The office could not open a browser window on this machine.'
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
  ]
  if (cfgWarnings.length) lines.push('', 'Warnings:', ...cfgWarnings.map(w => `- ${w}`))
  lines.push('', 'Edit the file and run /office-config again to apply it.')
  return lines.join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'office', description: 'Open the agent office: your agents at their desks' })
    await $.command.register({ name: 'office-popout', description: 'Open the office in a browser window, with a chat' })
    await $.command.register({ name: 'office-config', description: "Show or reload the office's config (cast, departments, pets)" })
    await $.tool.register({ name: 'open_office', description: 'Opens the agent office in a browser window, with a chat ' +
      'to Claude at its front desk. Call it when the user asks to open the office.' })
    await setup($)
    void $.ui.open({ id: PANE, title: TITLE })
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
        try {                                      // the browser copy (staff.js is the bridge's heartbeat too)
          if (pageKey && await scriptsChanged($)) pageKey = ''      // a script changed: rebuild, and pages reload
          if (!pageKey) await writePage($)
          else await writeStaff($, await read($, staff), now)
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
    return next(e)
  })

  on('command.run', { command: 'office-popout' }, async $ => ({ text: await openPopout($) }))
  on('command.run', { command: 'office-config' }, async $ => ({ text: await configText($) }))
  on('command.run', { command: 'office' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'The agent office is open.' }
  })
  // "open the office": Claude calls this tool, which opens the same window /office-popout does
  on('tool.call', { tool: 'mcp__agent-office__open_office' }, async $ => ({ result: await openPopout($) }))
    .catch(() => ({ result: 'The office could not open. Try /office-popout.' }))

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
            {s.isFailed ? 'failed ' : ''}{label(s.desk).padEnd(12)} {s.task} · {mins(s)}m
          </Text>
        ))}
      </Box>
    )
    if (!('Svg' in els)) return rows
    const { Svg } = els
    return (
      <Box flexDirection="column">
        <Svg source={office(list, now)} alt={`The office: ${working.length} agents at their desks, ${done.length} reports in the inbox`} isInteractive />
        {rows}
      </Box>
    )
  })
}
