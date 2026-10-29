// Small helpers shared by the hooks and the drawing.

export function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

// JSON that is safe inside a script: agent text is untrusted, and the page only ever sets it as text
export const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029')

// What the tag at an agent's desk says: a short friendly word for its latest tool, ten letters at most.
const TOOL_WORDS: Record<string, string> = {
  bash: 'terminal', powershell: 'terminal', monitor: 'terminal', read: 'reading', edit: 'editing', write: 'editing',
  multiedit: 'editing', notebookedit: 'editing', grep: 'searching', glob: 'searching', webfetch: 'web',
  websearch: 'web', agent: 'delegating', task: 'delegating', todowrite: 'planning', skill: 'skill',
  toolsearch: 'tools', artifact: 'publishing',
}
export function toolLabel(t?: string): string {
  const last = (t ?? '').split('__').pop() ?? ''
  if (!last) return ''
  const k = last.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (/screenshot|snapshot|capture/.test(k)) return 'screenshot'
  if (TOOL_WORDS[k]) return TOOL_WORDS[k]!
  const words = last.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s_.:-]+/).filter(Boolean)
  const name = (last.length <= 10 ? last : words[words.length - 1] ?? last).toLowerCase().replace(/[^a-z0-9 -]/g, '')
  return name.length > 10 ? name.slice(0, 9) + '…' : name
}

// Text for a speech bubble: an agent's or Claude's words with markup taken out (HTML tags, markdown's emphasis,
// code, headings, quotes, list marks; a link becomes its text), entities read, and whitespace collapsed.
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' }
export function plain(s: string): string {
  return s
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/<[^>\n]{0,200}>/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]*(#{1,6}|>+|[-*+]|\d+[.)])[ \t]+/gm, '')
    .replace(/^[ \t]*([-*_][ \t]*){3,}$/gm, ' ')
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, '$1$2')
    .replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1$2')
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/[*`]{2,}|~~/g, '')
    .replace(/\|/g, ' ')
    .replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, (_, e: string) => ENTITIES[e] ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}
// its first sentence, for a bubble
export const firstSentence = (s: string, max = 90) => (s.match(/^.{4,}?[.!?](?=\s|$)/)?.[0] ?? s).slice(0, max)

// a 256-bit random token, URL-safe
export function newToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function wrap(s: string, width: number, max: number): string[] {
  const out: string[] = []
  let cur = ''
  for (const word0 of s.split(' ')) {
    let word = word0
    while (word.length > width) {
      if (cur) out.push(cur)
      out.push(word.slice(0, width))
      cur = ''
      word = word.slice(width)
    }
    if (!cur) cur = word
    else if (cur.length + 1 + word.length <= width) cur += ' ' + word
    else {
      out.push(cur)
      cur = word
    }
  }
  if (cur) out.push(cur)
  if (out.length > max) {
    out.length = max
    out[max - 1] = (out[max - 1] ?? '').slice(0, width - 1).replace(/[\s,;:]+$/, '') + '…'
  }
  return out
}
