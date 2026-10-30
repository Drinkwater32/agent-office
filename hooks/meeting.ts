// The conference room's meetings. Pure functions only: register.tsx keeps the meeting in the session's state and
// writes the page's copy (meeting.js); these check and cap every field before it is kept or shown, and the page only
// ever sets it as text.
//
//   { id, title, topic?, status, agenda: [{ dept, title }], attendees: [{ id, name, dept, role }],
//     turns: [{ n, speaker_id, kind, text, title?, at }], called?, started?, updated }
//
// Who can attend comes from the config: you (the owner, id "owner"), Claude as the chair ("claude"), who always
// attend; and up to eight more of the departments (each speaks as itself, an agent in its color) and the named staff
// (who walk in themselves). `dept` is "chair", "owner" or a department's id (d0, d1, ...); a department's name works
// too when it is given.

export const STATUSES = ['scheduled', 'gathering', 'in_session', 'discussion', 'wrap_up', 'ended'] as const
export type Status = typeof STATUSES[number]
export const KINDS = ['proposal', 'reply', 'question', 'decision', 'note'] as const
export type Kind = typeof KINDS[number]

export const FILE_MAX = 256 * 1024       // the largest meeting text read (from the state or a file): bigger is no meeting
export const TEXT_MAX = 600              // a turn's text
export const TITLE_MAX = 120             // the meeting's title, a proposal's title, an agenda item
export const TOPIC_MAX = 120             // the topic the user typed when calling it
export const AGENDA_MAX = 8
export const OTHERS_MAX = 8              // attendees besides you and Claude: the chairs left at the table
export const TURNS_MAX = 200             // the transcript keeps its newest 200 turns
export const STALE_MS = 3 * 3_600_000    // a meeting nobody has touched for three hours is over, whatever it says
export const DEFAULT_TOPIC = 'Our priorities for the next week'
export const CHAIR_COLOR = '#d97757'
export const OWNER_COLOR = '#8b7bb8'

/** What the config says about who can attend: your name, the departments, the staff (each with an id). */
export type MeetCtx = {
  owner: string
  depts: { id: string; key: string; name: string; color: string }[]   // id d0..d7; key its name as an id ("engineering")
  staff: { id: string; key: string; name: string; dept: string }[]     // id s0..s11; key its name as an id, or teammate-1
}
export type Attendee = { id: string; name: string; dept: string; role: string }
export type AgendaItem = { dept: string; title: string }
export type Turn = { n: number; speaker_id: string; kind: Kind; text: string; title: string; at: number }
export type Meeting = { id: string; title: string; topic: string; status: Status; agenda: AgendaItem[]; attendees: Attendee[];
  turns: Turn[]; called: number; started: number; updated: number }

export const fixed = (ctx: MeetCtx): Attendee[] => [
  { id: 'claude', name: 'Claude', dept: 'chair', role: 'Chair' },
  { id: 'owner', name: ctx.owner || 'You', dept: 'owner', role: 'Owner' },
]

// -- small helpers: one line of text, control characters out, whitespace collapsed, capped
export const line = (v: unknown, max: number) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)     // \s takes the line separators
// a turn's text keeps its paragraph breaks (two at most in a row), nothing else of the control range
const prose = (v: unknown, max: number) => (typeof v === 'string' ? v : '')
  .replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/[^\S\n]+/g, ' ')
  .replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
const when = (v: unknown) => {
  const t = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isFinite(t) && t > 0 && t < 8.64e15 ? t : 0
}
const ID = /^[a-z0-9_-]{1,24}$/
export const cleanId = (v: unknown) => {
  const s = line(v, 40).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').slice(0, 24)
  return ID.test(s) ? s : ''
}
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined => {
  const s = line(v, 20).toLowerCase().replace(/[\s-]+/g, '_')
  return (list as readonly string[]).includes(s) ? s as T : undefined
}
export const statusOf = (v: unknown) => oneOf(STATUSES, v)
export const kindOf = (v: unknown) => oneOf(KINDS, v)
/** A department as the tool or a file names it: "chair", "owner", d0..d7, or a department's name. */
export function deptOf(v: unknown, ctx: MeetCtx): string | undefined {
  const s = line(v, 40).toLowerCase()
  if (!s) return undefined
  if (['chair', 'claude', 'front desk', 'front_desk'].includes(s)) return 'chair'
  if (s === 'owner' || s === 'you' || s === ctx.owner.toLowerCase()) return 'owner'
  const d = ctx.depts.find(x => x.id === s || x.key === s || x.name.toLowerCase() === s || x.key === cleanId(s))
  return d?.id
}

/** The ids the tool takes for each attendee, in the order they are offered. */
export function attendeeIds(ctx: MeetCtx): { id: string; name: string; dept: string; kind: 'claude' | 'owner' | 'agent' | 'crew' }[] {
  return [
    { id: 'claude', name: 'Claude', dept: 'chair', kind: 'claude' as const },
    { id: 'owner', name: ctx.owner || 'You', dept: 'owner', kind: 'owner' as const },
    ...ctx.depts.map(d => ({ id: d.key, name: d.name, dept: d.id, kind: 'agent' as const })),
    ...ctx.staff.map(s => ({ id: s.key, name: s.name, dept: s.dept, kind: 'crew' as const })),
  ]
}

function attendee(v: unknown, ctx: MeetCtx): Attendee | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const id = cleanId(o.id ?? o.name)
  if (!id) return undefined
  const f = fixed(ctx).find(x => x.id === id)
  if (f) return { ...f, role: line(o.role, 40) || f.role }          // you and Claude keep your names
  const known = attendeeIds(ctx).find(x => x.id === id)
  if (known) return { id, name: known.name, dept: known.dept, role: line(o.role, 40) }   // the config's people keep theirs
  return { id, name: line(o.name, 24) || id, dept: deptOf(o.dept, ctx) ?? 'chair', role: line(o.role, 40) }
}
/** You and Claude first, then up to eight more, each id once. */
export function cleanAttendees(v: unknown, ctx: MeetCtx): Attendee[] {
  const raw = (Array.isArray(v) ? v : []).slice(0, 40).map(a => attendee(a, ctx)).filter((a): a is Attendee => !!a)
  const out: Attendee[] = fixed(ctx).map(f => raw.find(a => a.id === f.id) ?? { ...f })
  for (const a of raw) {
    if (out.some(o => o.id === a.id)) continue
    if (out.length >= 2 + OTHERS_MAX) break
    out.push(a)
  }
  return out
}
export function cleanAgenda(v: unknown, ctx: MeetCtx): AgendaItem[] {
  return (Array.isArray(v) ? v : []).slice(0, 40).flatMap((x): AgendaItem[] => {
    if (!x || typeof x !== 'object') return []
    const o = x as Record<string, unknown>
    const title = line(o.title, TITLE_MAX)
    return title ? [{ dept: deptOf(o.dept, ctx) ?? 'chair', title }] : []
  }).slice(0, AGENDA_MAX)
}
/** One turn, or why not: the speaker must be in the room, and say something. */
export function cleanTurn(v: unknown, people: Attendee[], n: number, now: number): Turn | string {
  if (!v || typeof v !== 'object') return 'a turn needs speaker_id, kind and text'
  const o = v as Record<string, unknown>
  const speaker = cleanId(o.speaker_id)
  if (!speaker || !people.some(p => p.id === speaker)) {
    return `speaker_id "${line(o.speaker_id, 24)}" is not an attendee (${people.map(p => p.id).join(', ')})`
  }
  const text = prose(o.text, TEXT_MAX)
  if (!text) return 'a turn needs text'
  return { n, speaker_id: speaker, kind: kindOf(o.kind) ?? 'note', text, title: line(o.title, TITLE_MAX), at: when(o.at) || now }
}

/** A meeting as kept (or read from a file): anything not a meeting is undefined, and every field is checked. */
export function cleanMeeting(v: unknown, ctx: MeetCtx, mtime = 0): Meeting | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const o = v as Record<string, unknown>
  const id = cleanId(o.id)
  if (!id) return undefined
  const attendees = cleanAttendees(o.attendees, ctx)
  const turns: Turn[] = []
  const raw = Array.isArray(o.turns) ? o.turns.slice(-TURNS_MAX * 2) : []
  for (const t of raw) {                       // a turn keeps its number while they climb (the page plays each once)
    const last = turns[turns.length - 1]?.n ?? 0
    const given = t && typeof t === 'object' ? (t as { n?: unknown }).n : undefined
    const n = Number.isInteger(given) && (given as number) > last && (given as number) < 1e6 ? given as number : last + 1
    const c = cleanTurn(t, attendees, n, 0)
    if (typeof c !== 'string') turns.push(c)
  }
  return { id, title: line(o.title, TITLE_MAX) || line(o.topic, TOPIC_MAX) || 'Meeting', topic: line(o.topic, TOPIC_MAX),
    status: statusOf(o.status) ?? 'scheduled', agenda: cleanAgenda(o.agenda, ctx), attendees,
    turns: turns.slice(-TURNS_MAX), called: when(o.called), started: when(o.started), updated: when(o.updated) || mtime }
}
/** A meeting's JSON text: over the cap, or not JSON, is no meeting at all. */
export function parseMeeting(text: unknown, ctx: MeetCtx, mtime = 0): Meeting | undefined {
  if (typeof text !== 'string' || text.length > FILE_MAX) return undefined
  try {
    return cleanMeeting(JSON.parse(text), ctx, mtime)
  } catch {
    return undefined
  }
}

/** On: called, gathering, in session, in discussion or wrapping up, and touched in the last three hours. */
export const isLive = (m: Meeting | undefined, now: number): m is Meeting =>
  !!m && m.status !== 'ended' && now - m.updated < STALE_MS
export const decisions = (m: Meeting | undefined) => (m ? m.turns.filter(t => t.kind === 'decision') : [])
export const STATUS_WORDS: Record<Status, string> = { scheduled: 'called', gathering: 'gathering', in_session: 'in session',
  discussion: 'in discussion', wrap_up: 'wrapping up', ended: 'over' }

// -- the tool: office_meeting_update's arguments merged into the meeting. A new id (or none, when the last meeting is
// over) starts a new meeting; title, status, agenda and attendees replace what was there; a turn is appended.
export type MergeResult = { meeting: Meeting; notes: string[]; turn?: Turn }
export function mergeMeeting(prev: Meeting | undefined, a: Record<string, unknown>, ctx: MeetCtx, now: number): MergeResult {
  const notes: string[] = []
  const askedId = a.id === undefined ? '' : cleanId(a.id)
  if (a.id !== undefined && !askedId) notes.push('id ignored: use letters, digits, - or _ (24 at most)')
  const fresh = !prev || (askedId && askedId !== prev.id) || (!askedId && prev.status === 'ended' && !a.turn)
  const m: Meeting = fresh
    ? { id: askedId || `m${now.toString(36)}`, title: 'Meeting', topic: '', status: 'scheduled', agenda: [],
      attendees: cleanAttendees([], ctx), turns: [], called: 0, started: 0, updated: now }
    : { ...prev!, agenda: [...prev!.agenda], attendees: [...prev!.attendees], turns: [...prev!.turns] }
  if (a.title !== undefined) {
    const t = line(a.title, TITLE_MAX)
    if (t) m.title = t
    else notes.push('title ignored: empty')
  }
  if (a.status !== undefined) {
    const s = statusOf(a.status)
    if (s) m.status = s
    else notes.push(`status ignored: use ${STATUSES.join(', ')}`)
  }
  if (a.agenda !== undefined) {
    if (Array.isArray(a.agenda)) m.agenda = cleanAgenda(a.agenda, ctx)
    else notes.push('agenda ignored: an array of {dept, title}')
  }
  if (a.attendees !== undefined) {
    if (Array.isArray(a.attendees)) {
      m.attendees = cleanAttendees(a.attendees, ctx)
      const others = new Set(a.attendees.map(x => cleanId((x as { id?: unknown })?.id)).filter(id => id && id !== 'claude' && id !== 'owner'))
      if (others.size > OTHERS_MAX) notes.push(`only ${OTHERS_MAX} attendees besides you and Claude: the rest were left out`)
    } else notes.push('attendees ignored: an array of {id, name, dept, role}')
  }
  let turn: Turn | undefined
  if (a.turn !== undefined) {
    if (m.status === 'ended') notes.push('turn not recorded: the meeting has ended (a new id starts a new one)')
    else {
      const c = cleanTurn(a.turn, m.attendees, (m.turns[m.turns.length - 1]?.n ?? 0) + 1, now)
      if (typeof c === 'string') notes.push(`turn not recorded: ${c}`)
      else {
        turn = c
        m.turns = [...m.turns, c].slice(-TURNS_MAX)
      }
    }
  }
  if (m.status !== 'scheduled' && !m.started) m.started = now
  m.updated = now
  return { meeting: m, notes, turn }
}

/** What the tool says back: short, and never the turn's words. */
export function mergeReport(r: MergeResult): string {
  const m = r.meeting
  const by = r.turn ? m.attendees.find(p => p.id === r.turn!.speaker_id) : undefined
  const n = decisions(m).length
  return `Meeting "${m.title}" (${m.id}): ${STATUS_WORDS[m.status]}, ${m.attendees.length} attending, ` +
    `${m.turns.length} turn${m.turns.length === 1 ? '' : 's'}, ${n} decision${n === 1 ? '' : 's'}.` +
    (r.turn ? ` Recorded turn ${r.turn.n}: ${r.turn.kind} by ${by?.name ?? r.turn.speaker_id}.` : '') +
    (r.notes.length ? ` Note: ${r.notes.join('; ')}.` : '')
}

// -- calling a meeting (the command, or the office's button): the user's topic, capped and made one line of text
export const cleanTopic = (v: unknown) => line(v, TOPIC_MAX)
export function callMeeting(prev: Meeting | undefined, topic: unknown, ctx: MeetCtx, now: number): { meeting: Meeting } | { busy: string } {
  if (isLive(prev, now)) return { busy: `A meeting is already ${STATUS_WORDS[prev.status]}: "${prev.title}". One at a time.` }
  const t = cleanTopic(topic) || DEFAULT_TOPIC
  return { meeting: { id: `m${now.toString(36)}`, title: t, topic: t, status: 'scheduled', agenda: [],
    attendees: cleanAttendees([], ctx), turns: [], called: now, started: 0, updated: now } }
}

/** The prompt a call sends Claude: the protocol, the topic, and who can be in the room. */
export function meetPrompt(topic: string, ctx: MeetCtx): string {
  const who = attendeeIds(ctx).slice(2)
  const depts = ctx.depts.map(d => `${d.key} (${d.name})`).join(', ')
  const staff = ctx.staff.filter(s => !s.key.startsWith('teammate-')).map(s => s.key).join(', ')
  return `[Office] ${ctx.owner || 'The user'} called a meeting in the office's conference room: "${topic}". Run it with the ` +
    'office_meeting_update tool, step by step, so it can be watched live:\n' +
    `1. Gather: status "gathering", with the attendees (you chair as "claude"; "owner" is ${ctx.owner || 'the user'}; ` +
    `add up to ${OTHERS_MAX} of the departments${staff ? ' and staff' : ''}) and an agenda of one proposal per department.\n` +
    '2. Proposals: status "in_session"; each department presents its proposal as one turn (kind "proposal", a short title). ' +
    'Draft them yourself, or brief an agent per department first.\n' +
    '3. Discussion: status "discussion"; questions and replies across the departments, short turns. The owner may speak: ' +
    `their lines reach you as "${meetingPrefix(ctx)}..."; record each as their turn.\n` +
    '4. Decisions: status "wrap_up"; record each decision as a turn by "claude" (kind "decision").\n' +
    '5. End: status "ended", then sum up the decisions in a few lines.\n' +
    `Departments: ${depts || 'none'}.${staff ? ` Staff: ${staff}.` : ''} Never invent words for the owner.` +
    (who.length > OTHERS_MAX ? ` Pick the ${OTHERS_MAX} the topic needs most.` : '')
}

// -- saying something in the meeting: from the front desk with "Say in meeting" on, it reaches Claude as the owner's line
export const meetingPrefix = (ctx: MeetCtx) => `[Meeting] ${ctx.owner || 'You'}: `
export const meetingLine = (text: string, ctx: MeetCtx) => `${meetingPrefix(ctx)}${String(text ?? '').trim()}`

// -- what the page gets (the run folder's meeting.js): the meeting as checked, each attendee's chair, color and who
// they are in the office (the staff walk in themselves; a department comes as an agent in its color)
export type SeatKind = 'claude' | 'owner' | 'crew' | 'agent'
export function meetingView(m: Meeting | undefined, now: number, ctx: MeetCtx) {
  if (!m) return null
  const stale = m.status !== 'ended' && now - m.updated >= STALE_MS
  const colorOf = (dept: string) => dept === 'chair' ? CHAIR_COLOR : dept === 'owner' ? OWNER_COLOR
    : ctx.depts.find(d => d.id === dept)?.color ?? CHAIR_COLOR
  const labelOf = (dept: string) => dept === 'chair' ? 'CHAIR' : dept === 'owner' ? 'OWNER'
    : (ctx.depts.find(d => d.id === dept)?.name ?? '').toUpperCase()
  let next = 2                                   // the chairs: 0 the head (Claude), 1 the foot (you), then the sides
  const people = m.attendees.map(a => {
    const st = ctx.staff.find(s => s.key === a.id)
    const kind: SeatKind = a.id === 'claude' ? 'claude' : a.id === 'owner' ? 'owner' : st ? 'crew' : 'agent'
    const seat = a.id === 'claude' ? 0 : a.id === 'owner' ? 1 : next++
    const desk = st ? st.dept : ctx.depts.some(d => d.id === a.dept) ? a.dept : ctx.depts[0]?.id ?? 'd0'
    return { id: a.id, name: a.name, role: a.role, label: labelOf(a.dept), color: colorOf(a.dept), kind, seat, desk,
      crew: st ? st.id : '' }
  })
  return { id: m.id, title: m.title, topic: m.topic, status: stale ? 'ended' as Status : m.status, live: isLive(m, now),
    updated: m.updated, agenda: m.agenda.map(x => ({ title: x.title, label: labelOf(x.dept), color: colorOf(x.dept) })),
    attendees: people, turns: m.turns, decisions: decisions(m).map(t => t.text).slice(-8) }
}
