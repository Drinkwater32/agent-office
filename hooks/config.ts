// The office's cast and floor plan, from the user's office.config.json: who "You" are, the departments (rooms)
// agents are sent to and how they are picked, the named staff, and the pets. Everything here is checked: a field
// that is missing or wrong falls back to its default and says so in `warnings`, and nothing from the file is ever
// used unchecked (names are length- and character-limited, colors are #rrggbb, lists are capped).

export type Skin = 'fair' | 'light' | 'tan' | 'brown' | 'deep'
export type HairStyle = 'crop' | 'curls' | 'bun' | 'beanie' | 'cap' | 'long' | 'lob' | 'buzz' | 'swoop' | 'puffs' | 'twists'
export const SKINS: readonly Skin[] = ['fair', 'light', 'tan', 'brown', 'deep']
export const STYLES: readonly HairStyle[] = ['crop', 'curls', 'bun', 'beanie', 'cap', 'long', 'lob', 'buzz', 'swoop',
  'puffs', 'twists']

// How a person is drawn. hat colors a beanie or a cap; phones are headphones; glasses true (dark frames) or 'clear'.
export type Look = { skin: Skin; hair: string; style: HairStyle; hoodie: string; pants?: string; shoes?: string;
  hat?: string; phones?: string; glasses?: boolean | 'clear'; beard?: boolean; knit?: boolean }

export type PetCoat = 'short' | 'long'
export type PetColor = 'orange' | 'cream' | 'gray' | 'black' | 'brown' | 'white'
export const PET_COLORS: readonly PetColor[] = ['orange', 'cream', 'gray', 'black', 'brown', 'white']

export type Department = { name: string; color: string; agentTypes: string[]; keywords: string[] }
export type Staff = { name: string; look: Look }
export type Pet = { name: string; coat: PetCoat; color: PetColor }
export type OfficeConfig = {
  owner: { name: string; look: Look }
  claude: { look: Look }      // Claude, at the front desk and chairing meetings: its look (its name stays Claude)
  departments: Department[]
  routing: 'match' | 'round-robin'
  staff: Staff[]
  pets: Pet[]
  usage: UsageConfig
  deadline?: Deadline
  seasons: boolean
  openOnStart: boolean       // the browser window opens as a session starts
  soundtrack: { enabled: boolean }   // the lo-fi toggle in the window's title bar (playback always starts off)
}
// the usage guard: a warning (and a handoff asked of Claude) at warnAt %, the office closed at closeAt %; the handoff
// file relative to the project's folder (or absolute), '' for no handoff prompt
export type UsageConfig = { warnAt: number; closeAt: number; handoffFile: string; extra: 'auto' | 'on' | 'off' }
// the whiteboard's countdown: a label, and a date and time on this machine's clock
export type Deadline = { label: string; y: number; mo: number; d: number; h: number; mi: number }
export const DEFAULT_USAGE: UsageConfig = { warnAt: 90, closeAt: 98, handoffFile: '.agent-office/HANDOFF.md', extra: 'auto' }

export const MAX_DEPARTMENTS = 8
export const MAX_STAFF = 12
export const MAX_PETS = 4
export const MAX_FILE_BYTES = 64 * 1024

export const PALETTE = ['#7c3aed', '#ef4444', '#f59e0b', '#14b8a6', '#3b82f6', '#ec4899', '#22c55e', '#f97316']

const DEFAULT_OWNER_LOOK: Look = { skin: 'light', hair: '#3b2a20', style: 'crop', hoodie: '#5b6b8c', pants: '#2b2836' }
export const DEFAULT_CLAUDE_LOOK: Look = { skin: 'light', hair: '#6b3b22', style: 'crop', hoodie: '#d97757', phones: '#d97757',
  pants: '#3a3550', shoes: '#f1ede6' }

// the staff when the file names none: a mixed crew, unnamed (their tooltips say "a teammate")
export const STAFF_LOOKS: Look[] = [
  { skin: 'fair', hair: '#4a2e1c', style: 'beanie', beard: true, hoodie: '#2f4a7a', hat: '#e4572e', pants: '#b49a6a' },
  { skin: 'brown', hair: '#1d140f', style: 'puffs', hoodie: '#6f9a7a', pants: '#3d4a6b' },
  { skin: 'tan', hair: '#2a1c14', style: 'crop', beard: true, glasses: true, hoodie: '#2f6f6a', pants: '#b49a6a' },
  { skin: 'light', hair: '#8f3f1e', style: 'curls', hoodie: '#e0b034', phones: '#14b8a6', pants: '#2b2836' },
  { skin: 'deep', hair: '#1d140f', style: 'twists', hoodie: '#3a3a46', pants: '#5a5866' },
  { skin: 'fair', hair: '#b5432a', style: 'bun', hoodie: '#14b8a6', pants: '#4a4560' },
  { skin: 'light', hair: '#1d140f', style: 'cap', beard: true, hoodie: '#c8643b', hat: '#2b2533', pants: '#3d4a6b' },
  { skin: 'brown', hair: '#2a1c14', style: 'bun', hoodie: '#7d8b3c', pants: '#2b2836' },
  { skin: 'tan', hair: '#4fd1c5', style: 'long', hoodie: '#3a3a46', pants: '#5a5866' },
  { skin: 'deep', hair: '#2a1c14', style: 'buzz', glasses: true, hoodie: '#22c55e', pants: '#3d4a6b' },
  { skin: 'fair', hair: '#7a4322', style: 'swoop', hoodie: '#0ea5e9', pants: '#2b2836' },
  { skin: 'light', hair: '#5a3220', style: 'lob', hoodie: '#e11d48', pants: '#4a4560' },
]

export const DEFAULT_DEPARTMENTS: Department[] = [
  { name: 'Engineering', color: PALETTE[0]!, agentTypes: ['general-purpose'], keywords: ['implement', 'build', 'fix',
    'bug', 'refactor', 'code', 'feature', 'migrat', 'add ', 'port', 'wire', 'endpoint', 'api', 'function', 'script',
    'deploy', 'upgrade', 'install'] },
  { name: 'Review', color: PALETTE[1]!, agentTypes: [], keywords: ['review', 'audit', 'verify', 'check', 'test',
    'inspect', 'critic', 'judge', 'qa', 'security', 'lint', 'validate', 'scrub', 'reproduce'] },
  { name: 'Design', color: PALETTE[2]!, agentTypes: [], keywords: ['design', 'ui', 'ux', 'css', 'layout', 'screenshot',
    'style', 'visual', 'page', 'copy', 'docs', 'document', 'readme', 'write', 'wording', 'chart', 'icon', 'theme'] },
  { name: 'Research', color: PALETTE[3]!, agentTypes: ['Explore', 'Plan'], keywords: ['research', 'explore', 'search',
    'find', 'investigate', 'analy', 'look up', 'survey', 'compare', 'plan', 'understand', 'map', 'locate', 'read'] },
]

export function defaultConfig(): OfficeConfig {
  return {
    owner: { name: 'You', look: { ...DEFAULT_OWNER_LOOK } },
    claude: { look: { ...DEFAULT_CLAUDE_LOOK } },
    departments: DEFAULT_DEPARTMENTS.map(d => ({ ...d, agentTypes: [...d.agentTypes], keywords: [...d.keywords] })),
    routing: 'match',
    staff: STAFF_LOOKS.slice(0, 6).map(look => ({ name: '', look })),
    pets: [{ name: 'Pixel', coat: 'short', color: 'gray' }, { name: 'Noodle', coat: 'long', color: 'black' }],
    usage: { ...DEFAULT_USAGE },
    seasons: true,
    openOnStart: true,
    soundtrack: { enabled: true },
  }
}

// the starter file (/office-config writes it when there is none)
export const EXAMPLE_CONFIG = {
  owner: { name: 'You' },
  departments: DEFAULT_DEPARTMENTS.map(d => ({ name: d.name, color: d.color, agentTypes: d.agentTypes,
    keywords: d.keywords })),
  routing: 'match',
  staff: [{ name: '' }, { name: '' }, { name: '' }, { name: '' }, { name: '' }, { name: '' }],
  pets: [{ name: 'Pixel', coat: 'short', color: 'gray' }, { name: 'Noodle', coat: 'long', color: 'black' }],
  usage: { ...DEFAULT_USAGE },
  seasons: true,
  openOnStart: true,
  soundtrack: { enabled: true },
}

// -- checks
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} .'&-]*$/u
const COLOR = /^#[0-9a-fA-F]{6}$/
const AGENT_TYPE = /^[\w:.-]{1,64}$/
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function nameOf(v: unknown, max: number, where: string, warn: (s: string) => void): string | undefined {
  if (v === undefined || v === null || v === '') return undefined
  if (typeof v !== 'string') return void warn(`${where}: a name must be text.`)
  const s = v.normalize('NFC').trim().replace(/\s+/g, ' ')
  if (!s) return undefined
  if ([...s].length > max) return void warn(`${where}: "${clip(s)}" is longer than ${max} characters.`)
  if (!NAME.test(s)) return void warn(`${where}: "${clip(s)}" may hold only letters, digits, spaces and . ' & -`)
  return s
}
const clip = (s: string) => ([...s].length > 24 ? [...s].slice(0, 24).join('') + '…' : s).replace(/[\u0000-\u001f\u007f]/g, '')

function colorOf(v: unknown, where: string, warn: (s: string) => void): string | undefined {
  if (v === undefined || v === null || v === '') return undefined
  if (typeof v === 'string' && COLOR.test(v)) return v.toLowerCase()
  warn(`${where}: colors are written #rrggbb.`)
  return undefined
}

function lookOf(v: unknown, base: Look, where: string, warn: (s: string) => void): Look {
  if (v === undefined) return { ...base }
  if (!isObj(v)) {
    warn(`${where}: "look" must be an object.`)
    return { ...base }
  }
  const out: Look = { ...base }
  if (v.skin !== undefined) {
    if (SKINS.includes(v.skin as Skin)) out.skin = v.skin as Skin
    else warn(`${where}.skin: one of ${SKINS.join(', ')}.`)
  }
  if (v.style !== undefined) {
    if (STYLES.includes(v.style as HairStyle)) out.style = v.style as HairStyle
    else warn(`${where}.style: one of ${STYLES.join(', ')}.`)
  }
  for (const [key, field] of [['hair', 'hair'], ['top', 'hoodie'], ['pants', 'pants'], ['shoes', 'shoes'],
    ['hat', 'hat'], ['headphones', 'phones']] as const) {
    const c = colorOf(v[key], `${where}.${key}`, warn)
    if (c) out[field] = c
  }
  if (v.glasses !== undefined) {
    if (v.glasses === true || v.glasses === false || v.glasses === 'clear') out.glasses = v.glasses
    else warn(`${where}.glasses: true, false or "clear".`)
  }
  for (const key of ['beard', 'knit'] as const) {
    if (v[key] === undefined) continue
    if (typeof v[key] === 'boolean') out[key] = v[key] as boolean
    else warn(`${where}.${key}: true or false.`)
  }
  return out
}

function words(v: unknown, max: number, test: (s: string) => boolean, where: string, warn: (s: string) => void): string[] {
  if (v === undefined) return []
  if (!Array.isArray(v)) {
    warn(`${where}: a list of text.`)
    return []
  }
  const out: string[] = []
  for (const w of v) {
    if (typeof w !== 'string' || !test(w)) {
      warn(`${where}: skipped an entry that is not allowed.`)
      continue
    }
    if (out.length >= max) {
      warn(`${where}: at most ${max}; the rest are ignored.`)
      break
    }
    out.push(w)
  }
  return out
}

/** Reads the file's text; never throws. An empty or missing file is the defaults. */
export function parseConfig(text: string | undefined): { config: OfficeConfig; warnings: string[] } {
  const warnings: string[] = []
  const warn = (s: string) => { if (warnings.length < 50) warnings.push(s) }
  const config = defaultConfig()
  if (text === undefined || !text.trim()) return { config, warnings }
  if (text.length > MAX_FILE_BYTES) {
    warn(`The file is larger than ${MAX_FILE_BYTES / 1024} KB; using the defaults.`)
    return { config, warnings }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''))
  } catch (err) {
    warn(`The file is not valid JSON (${String(err instanceof Error ? err.message : err).slice(0, 120)}); using the defaults.`)
    return { config, warnings }
  }
  if (!isObj(raw)) {
    warn('The file must hold one JSON object; using the defaults.')
    return { config, warnings }
  }
  for (const k of Object.keys(raw)) {
    if (!['owner', 'claude', 'departments', 'routing', 'staff', 'pets', 'usage', 'deadline', 'seasons', 'openOnStart', 'soundtrack', '$schema', '//'].includes(k)) {
      warn(`Unknown field "${clip(k)}" ignored.`)
    }
  }

  // the owner: "You" unless named
  if (raw.owner !== undefined) {
    if (!isObj(raw.owner)) warn('owner: must be an object.')
    else {
      config.owner.name = nameOf(raw.owner.name, 16, 'owner.name', warn) ?? 'You'
      config.owner.look = lookOf(raw.owner.look, config.owner.look, 'owner.look', warn)
      for (const k of Object.keys(raw.owner)) if (!['name', 'look'].includes(k)) warn(`owner: unknown field "${clip(k)}" ignored.`)
    }
  }
  // Claude: its look (its name is always Claude)
  if (raw.claude !== undefined) {
    if (!isObj(raw.claude)) warn('claude: must be an object.')
    else {
      config.claude.look = lookOf(raw.claude.look, config.claude.look, 'claude.look', warn)
      for (const k of Object.keys(raw.claude)) {
        if (k !== 'look') warn(k === 'name' ? 'claude.name: Claude keeps its name; only its look changes.' : `claude: unknown field "${clip(k)}" ignored.`)
      }
    }
  }

  // the departments: 1 to 8, each named, a color each (the palette's when none), and how agents are matched to it
  if (raw.departments !== undefined) {
    if (!Array.isArray(raw.departments) || raw.departments.length === 0) {
      warn('departments: a list of 1 to 8 departments; using the defaults.')
    } else {
      const list: Department[] = []
      let over = false
      raw.departments.forEach((d, i) => {
        const where = `departments[${i}]`
        if (list.length >= MAX_DEPARTMENTS) return void (over = true)
        if (!isObj(d)) return warn(`${where}: must be an object; skipped.`)
        const name = nameOf(d.name, 16, `${where}.name`, warn)
        if (!name) return warn(`${where}: needs a name; skipped.`)
        list.push({
          name,
          color: colorOf(d.color, `${where}.color`, warn) ?? PALETTE[list.length % PALETTE.length]!,
          agentTypes: words(d.agentTypes, 16, s => AGENT_TYPE.test(s), `${where}.agentTypes`, warn),
          keywords: words(d.keywords, 60, s => s.trim().length >= 2 && s.length <= 40 && !/[\u0000-\u001f]/.test(s),
            `${where}.keywords`, warn).map(s => s.toLowerCase()),
        })
      })
      if (over) warn(`departments: at most ${MAX_DEPARTMENTS}; the rest are ignored.`)
      if (list.length) config.departments = list
      else warn('departments: none were usable; using the defaults.')
    }
  }

  if (raw.routing !== undefined) {
    if (raw.routing === 'match' || raw.routing === 'round-robin') config.routing = raw.routing
    else warn('routing: "match" or "round-robin".')
  }

  // the staff: up to 12, each a name (or "" for an unnamed teammate) and an optional look
  if (raw.staff !== undefined) {
    if (!Array.isArray(raw.staff)) warn('staff: a list; using the defaults.')
    else {
      const list: Staff[] = []
      let over = false
      raw.staff.forEach((s, i) => {
        const where = `staff[${i}]`
        if (list.length >= MAX_STAFF) return void (over = true)
        const base = STAFF_LOOKS[list.length % STAFF_LOOKS.length]!
        if (typeof s === 'string') return void list.push({ name: nameOf(s, 16, where, warn) ?? '', look: { ...base } })
        if (!isObj(s)) return warn(`${where}: a name or an object; skipped.`)
        list.push({ name: nameOf(s.name, 16, `${where}.name`, warn) ?? '', look: lookOf(s.look, base, `${where}.look`, warn) })
      })
      if (over) warn(`staff: at most ${MAX_STAFF}; the rest are ignored.`)
      config.staff = list
    }
  }

  // the pets: up to 4, each named, short- or long-haired, and a coat color
  if (raw.pets !== undefined) {
    if (!Array.isArray(raw.pets)) warn('pets: a list; using the defaults.')
    else {
      const list: Pet[] = []
      let over = false
      raw.pets.forEach((p, i) => {
        const where = `pets[${i}]`
        if (list.length >= MAX_PETS) return void (over = true)
        if (!isObj(p)) return warn(`${where}: must be an object; skipped.`)
        const name = nameOf(p.name, 16, `${where}.name`, warn) ?? `Pet ${list.length + 1}`
        let coat: PetCoat = list.length % 2 ? 'long' : 'short'
        if (p.coat !== undefined) {
          if (p.coat === 'short' || p.coat === 'long') coat = p.coat
          else warn(`${where}.coat: "short" or "long".`)
        }
        let color: PetColor = coat === 'long' ? 'black' : 'gray'
        if (p.color !== undefined) {
          if (PET_COLORS.includes(p.color as PetColor)) color = p.color as PetColor
          else warn(`${where}.color: one of ${PET_COLORS.join(', ')}.`)
        }
        list.push({ name, coat, color })
      })
      if (over) warn(`pets: at most ${MAX_PETS}; the rest are ignored.`)
      config.pets = list
    }
  }

  if (raw.usage !== undefined) config.usage = usageOf(raw.usage, warn)
  if (raw.deadline !== undefined && raw.deadline !== null) config.deadline = deadlineOf(raw.deadline, warn)
  if (raw.seasons !== undefined) {
    if (typeof raw.seasons === 'boolean') config.seasons = raw.seasons
    else warn('seasons: true or false.')
  }
  if (raw.openOnStart !== undefined) {
    if (typeof raw.openOnStart === 'boolean') config.openOnStart = raw.openOnStart
    else warn('openOnStart: true or false.')
  }
  if (raw.soundtrack !== undefined) {
    const st = raw.soundtrack
    if (isObj(st) && typeof st.enabled === 'boolean') config.soundtrack = { enabled: st.enabled }
    else if (typeof st === 'boolean') config.soundtrack = { enabled: st }
    else warn('soundtrack: { "enabled": true } or { "enabled": false }.')
  }
  return { config, warnings }
}

// The usage guard's settings: whole percentages, the warning before the close. The handoff file is a plain path to a
// .md or .txt file, relative to the project's folder or absolute, with no ".." in it; "" (or null) asks for no handoff.
const HANDOFF_FILE = /^[^\u0000-\u001f\u007f"'`<>|*?]{1,200}\.(md|markdown|txt)$/i
function usageOf(v: unknown, warn: (s: string) => void): UsageConfig {
  const out: UsageConfig = { ...DEFAULT_USAGE }
  if (!isObj(v)) {
    warn('usage: must be an object; using the defaults.')
    return out
  }
  for (const k of Object.keys(v)) if (!['warnAt', 'closeAt', 'handoffFile', 'extra'].includes(k)) warn(`usage: unknown field "${clip(k)}" ignored.`)
  const whole = (n: unknown, lo: number, hi: number) => typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi
  if (v.warnAt !== undefined) {
    if (whole(v.warnAt, 50, 99)) out.warnAt = v.warnAt as number
    else warn('usage.warnAt: a whole number from 50 to 99.')
  }
  if (v.closeAt !== undefined) {
    if (whole(v.closeAt, 51, 100)) out.closeAt = v.closeAt as number
    else warn('usage.closeAt: a whole number from 51 to 100.')
  }
  if (out.closeAt <= out.warnAt) {
    warn(`usage: the close (${out.closeAt}) has to come after the warning (${out.warnAt}); using ` +
      `${DEFAULT_USAGE.warnAt} and ${DEFAULT_USAGE.closeAt}.`)
    out.warnAt = DEFAULT_USAGE.warnAt
    out.closeAt = DEFAULT_USAGE.closeAt
  }
  // extra usage: auto (overtime once a turn is answered past the limit), on (never close on a percentage), off
  if (v.extra !== undefined) {
    if (v.extra === 'auto' || v.extra === 'on' || v.extra === 'off') out.extra = v.extra
    else warn('usage.extra: "auto", "on" or "off".')
  }
  if (v.handoffFile === null || v.handoffFile === '') out.handoffFile = ''
  else if (v.handoffFile !== undefined) {
    const f = typeof v.handoffFile === 'string' ? v.handoffFile.trim() : ''
    if (HANDOFF_FILE.test(f) && !f.split(/[\\/]/).includes('..')) out.handoffFile = f
    else warn('usage.handoffFile: a path to a .md or .txt file (no ".." in it), or "" for no handoff.')
  }
  return out
}

// The whiteboard's countdown: { label, at: "2026-12-01" or "2026-12-01T17:00" }, on this machine's clock.
const WHEN = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/
function deadlineOf(v: unknown, warn: (s: string) => void): Deadline | undefined {
  if (!isObj(v)) return void warn('deadline: an object with "label" and "at".')
  const label = nameOf(v.label, 16, 'deadline.label', warn) ?? 'Deadline'
  const m = typeof v.at === 'string' ? WHEN.exec(v.at.trim()) : null
  if (!m) return void warn('deadline.at: a date, "2026-12-01", or a date and time, "2026-12-01T17:00".')
  const [y, mo, d, h, mi] = [+m[1]!, +m[2]!, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0)]
  const real = new Date(y, mo - 1, d, h, mi)
  if (h > 23 || mi > 59 || real.getMonth() !== mo - 1 || real.getDate() !== d) return void warn('deadline.at: not a real date.')
  return { label, y, mo, d, h, mi }
}
export const deadlineAt = (d: Deadline) => new Date(d.y, d.mo - 1, d.d, d.h, d.mi).getTime()

/** A name as an id: lowercase letters, digits and dashes, 24 at most ('' when nothing is left). */
export const slug = (s: string) => s.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24)
  .replace(/-+$/, '')

/**
 * Which department an agent goes to. "match": the first department listing its agent type, else the one whose
 * keywords its description and prompt hit most (ties to the earlier department), else in turn. "round-robin": in
 * turn. `seq` is how many agents the office has seen this session.
 */
export function routeAgent(cfg: OfficeConfig, info: { type?: string; text: string }, seq: number): number {
  const n = cfg.departments.length
  const turn = ((seq % n) + n) % n
  if (cfg.routing === 'round-robin') return turn
  const type = (info.type ?? '').toLowerCase()
  if (type) {
    const i = cfg.departments.findIndex(d => d.agentTypes.some(t => t.toLowerCase() === type))
    if (i >= 0) return i
  }
  const t = info.text.toLowerCase()
  let best = -1
  let most = 0
  cfg.departments.forEach((d, i) => {
    const hits = d.keywords.filter(w => t.includes(w)).length
    if (hits > most) {
      best = i
      most = hits
    }
  })
  return best >= 0 ? best : turn
}
