// The drawing: the office from above at a 3/4 angle, the way top-down pixel-art games draw a house. The department
// rooms with walls and doorways, your office behind its one door, the lobby where Claude keeps the front desk by the
// entrance, the kitchen, the lounge, and (in the browser window) the conference room with its whiteboard. Drawn in art
// pixels into small buffers, outlined, written out as one path per color and scaled up twice. The pane gets the scene
// west of the conference room, animated in place; the browser copy gets the office without anyone who walks, and its
// own script (popout/engine.js) walks everyone about. The sky follows this machine's clock, the desk lamps come on at
// night, and the season's decor follows its calendar (clock.ts).

import type { Staffer } from '../types'
import { BOARD } from './board'
import type { Season } from './clock'
import { seasonOf } from './clock'
import type { HairStyle, Look, OfficeConfig, Pet, PetColor, Skin } from './config'
import { STYLES as STYLE_LIST, defaultConfig } from './config'
import { EGG_CODES } from './eggs'
import type { CatFrame, Crew, Dept, Plan, Pt } from './plan'
import { AH, CONF, DY, SHIFT, buildPlan, coatBuild, deskTop, homeY, inkOn, seatX } from './plan'
import { esc, hash, plain, toolLabel, wrap } from './util'

// -- the plan in force: set from the config at the session's start and whenever the config is read again
let P: Plan = buildPlan(defaultConfig())
export function setPlan(cfg: OfficeConfig): Plan {
  P = buildPlan(cfg)
  return P
}
export const plan = () => P
// A desk from the stored state, which may name a department the config no longer has: those sit in the first.
export const deptOf = (id: string): Dept => P.depts.find(d => d.id === id) ?? P.depts[0]!

// What the staff say when two of them meet: a line and its answer, one bubble each.
const CHATTER: [string, string][] = [
  ['Who drank the last cold brew?', 'It was empty when I got here.'],
  ['New arcade high score posted.', 'Three letters: not mine.'],
  ['Who added polka to the playlist?', 'Nobody will admit it.'],
  ['Standup ran long again.', 'Someone said "quick question".'],
  ['Pizza Friday is back on?', 'Pineapple stays in its own box.'],
  ['Did the build go green?', 'Second try. We do not talk about the first.'],
  ['Who left a mug in the sink?', 'It was like that when I got here.'],
  ['Foosball rematch?', 'Loser restocks the fridge.'],
  ['Who is on snack duty?', 'Whoever lost at foosball.'],
  ['Did the playlist skip again?', 'Shuffle has a sense of humor.'],
  ['The fridge is all hot sauce.', 'Someone meal prepped vibes.'],
  ['Coffee machine is making noises.', 'It does that when it likes you.'],
  ['Who set the thermostat to arctic?', 'It keeps the servers happy.'],
  ['The arcade machine ate my quarter.', 'It hungers.'],
  ['Did you vote on lunch?', 'Tacos won by a landslide.'],
  ['New playlist dropped.', 'It is just one song on loop.'],
  ['Can I borrow your charger?', 'Only if it comes back.'],
  ['Who is on the couch tonight?', 'Whoever gets the remote first.'],
  ['Tabs or spaces?', 'Asking that here starts a fight.'],
  ['Did you name that variable "thing"?', 'Temporarily. Since March.'],
  ['The tests pass on my machine.', 'Then we ship your machine.'],
  ['Is it a bug or a feature?', 'Depends who is asking.'],
  ['Merge conflict again?', 'We both fixed the same typo.'],
  ['How many tabs do you have open?', 'Yes.'],
  ['Who wrote this regex?', 'Past me. We are not in touch.'],
  ['Rubber duck is on my desk.', 'It has solved more bugs than me.'],
  ['Did the agents finish?', 'Two did. One is still reading.'],
  ['Reviews are back.', 'Mostly nits. One real catch.'],
  ['Inbox zero?', 'Inbox some.'],
  ['Long day?', 'Long log file.'],
  ['Lunch walk later?', 'If the sun stays out.'],
  ['Who restocked the snacks?', 'A hero who asked for no credit.'],
  ['Plant needs water.', 'It is a plastic plant.'],
  ['Retro is at four.', 'I will bring the sticky notes.'],
  ['Did you see the new monitor?', 'It has more pixels than our office.'],
  ['My keyboard is too loud?', 'We call it the woodpecker.'],
  ['Board games Friday?', 'Only if nobody brings the long one.'],
  ['The cat sat on my keyboard.', 'Best commit message this week.'],
  ['Any good podcast picks?', 'Silence. Highly rated.'],
  ['Did you try turning it off and on?', 'Twice. It liked the second time.'],
]

const OUT = '#1a0f26'
const FONT = `font-family="Consolas, 'Courier New', monospace"`

// -- colors: shadows lean to deep purple, not to gray
function rgb(c: string): number[] {
  const n = parseInt(c.slice(1, 7), 16)
  return [n >> 16, (n >> 8) & 255, n & 255]
}
function mix(a: string, b: string, f: number): string {
  const x = rgb(a)
  const y = rgb(b)
  return '#' + x.map((v, i) => Math.round(v + ((y[i] ?? v) - v) * f).toString(16).padStart(2, '0')).join('')
}
const dark = (c: string, f = 0.25) => mix(c, '#140a24', f)
const light = (c: string, f = 0.25) => mix(c, '#ffffff', f)

// -- pixels: a buffer is a map of art pixels to colors; ring() outlines it; paths() writes one path per color,
// merging runs into rectangles
type Buf = Map<number, string>
const at = (x: number, y: number) => (y + 64) * 1024 + x + 64

function fill(b: Buf, x: number, y: number, w: number, h: number, c: string): Buf {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) b.set(at(i, j), c)
  return b
}
function dot(b: Buf, pts: number[][], c: string): Buf {
  for (const [x = 0, y = 0] of pts) b.set(at(x, y), c)
  return b
}
function stamp(b: Buf, x: number, y: number, rows: string[], pal: Record<string, string>): Buf {
  rows.forEach((row, j) => [...row].forEach((ch, i) => {
    const c = pal[ch]
    if (ch === 'x') b.delete(at(x + i, y + j))
    else if (c) b.set(at(x + i, y + j), c)
  }))
  return b
}
// a 1px outline around what's drawn, skipping pixels another buffer (under) already covers
function ring(b: Buf, c = OUT, under?: Buf): Buf {
  const add: number[] = []
  for (const k of b.keys()) {
    for (const n of [k - 1, k + 1, k - 1024, k + 1024]) if (!b.has(n) && !under?.has(n)) add.push(n)
  }
  for (const n of add) b.set(n, c)
  return b
}
// a buffer as [color, path data, opacity?] per color, rectangles merged
type PathList = [string, string, number?][]
function pathList(b: Buf): PathList {
  type Run = [number, number, number, number]   // x, y, width, height
  const keys = [...b.keys()].sort((p, q) => p - q)
  const runs = new Map<string, Run[]>()
  for (let i = 0; i < keys.length;) {
    const k = keys[i] ?? 0
    const c = b.get(k) ?? ''
    let w = 1
    while (keys[i + w] === k + w && b.get(k + w) === c) w++
    const list = runs.get(c) ?? []
    runs.set(c, list)
    list.push([(k % 1024) - 64, Math.floor(k / 1024) - 64, w, 1])
    i += w
  }
  const out: PathList = []
  for (const [c, list] of runs) {
    const open = new Map<string, Run>()
    const rects: Run[] = []
    for (const r of list) {
      const id = `${r[0]},${r[2]}`
      const o = open.get(id)
      if (o && o[1] + o[3] === r[1]) o[3]++
      else {
        open.set(id, r)
        rects.push(r)
      }
    }
    let d = ''
    let px = 0
    let py = 0
    for (const [x, y, w, h] of rects) {
      d += `${d ? `m${x - px} ${y - py}` : `M${x} ${y}`}h${w}v${h}h${-w}`
      px = x
      py = y + h
    }
    if (c.length > 7) out.push([c.slice(0, 7), d, +(parseInt(c.slice(7), 16) / 255).toFixed(2)])
    else out.push([c, d])
  }
  return out
}
const paths = (b: Buf) => pathList(b).map(([c, d, o]) =>
  `<path fill="${c}"${o === undefined ? '' : ` fill-opacity="${o}"`} d="${d}"/>`).join('')
// draw into a fresh buffer, outline it (or not), and write it out
function art(draw: (b: Buf) => void, outline: string | false = OUT): string {
  const b: Buf = new Map()
  draw(b)
  if (outline) ring(b, outline)
  return paths(b)
}
const g = (inner: string, attrs = '') => `<g${attrs}>${inner}</g>`
// a drawing the scene repeats (a desk, a chair, a plant), drawn once at the origin and placed with <use>
const SHARED = new Map<string, string>()
function use(id: string, x: number, y: number, draw: () => string): string {
  if (!SHARED.has(id)) SHARED.set(id, `<g id="nr-${id}">${draw()}</g>`)
  return `<use href="#nr-${id}" x="${x}" y="${y}"/>`
}
const rect = (x: number, y: number, w: number, h: number, f: string, more = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}"${more}/>`
const text = (x: number, y: number, size: number, f: string, t: string, more = '') =>
  `<text x="${x}" y="${y}" font-size="${size}" ${FONT} fill="${f}"${more}>${esc(t)}</text>`

// -- time: a looping animation, and one that holds each value from a time (in seconds) to the next
const anim = (attr: string, values: string, dur: number, begin = 0, more = '') =>
  `<animate attributeName="${attr}" values="${values}" dur="${dur}s"${begin ? ` begin="${begin}s"` : ''} repeatCount="indefinite"${more}/>`
function steps(dur: number, at0: [number, string | number][], begin = 0, attr = 'opacity'): string {
  return `<animate attributeName="${attr}" calcMode="discrete" dur="${dur}s"${begin ? ` begin="${begin}s"` : ''} ` +
    `repeatCount="indefinite" keyTimes="${at0.map(s => +(s[0] / dur).toFixed(4)).join(';')}" values="${at0.map(s => s[1]).join(';')}"/>`
}
// shown only from `from` to `to` seconds of every `dur`
const window_ = (dur: number, from: number, to: number, begin = 0) =>
  steps(dur, from > 0 ? [[0, 0], [from, 1], [to, 0]] : [[0, 1], [to, 0]], begin)

// -- people: twelve art pixels across and 21 down, built in layers. S skin and s its shade, E eyes, B blush, M mouth,
// T the hoodie and t its shade, w drawstrings, p a pocket, L and l pants, F and f sneakers; H, h and G hair; K and k a
// hat; Q and q headphones; g glasses; P a phone; m and n a mug. Seen from the front, the back, or the side (facing
// right; facing left is the same drawing flipped).
type View = 'front' | 'back' | 'side'
type CatLook = { build: 'small' | 'big'; coat: string; stripe: string; cream?: string; white: string; eyes: string;
  speed: number }

const FRONT = [
  '............', '............', '....SSSS....', '...SSSSSS...', '..SSSSSSSS..', '..SSSSSSSS..', '..SSESSESS..',
  '..SSESSESS..', '..SBSSSSBS..', '...SSMMSS...', '...TssssT...', '..TTTTTTTT..', '..TTwTTwTT..', '..TTwTTwTT..',
  '..TTTTTTTT..', '..TTTTTTTT..', '..tTppppTt..', '..tttttttt..', '..LLLLLLLL..', '..LLl..lLL..', '..FFf..fFF..',
]
const BACK = [
  '............', '............', '....HHHH....', '...HHHHHH...', '..HHHHHHHH..', '..HHHHHHHH..', '..SHHHHHHS..',
  '..SHHHHHHS..', '..HHHHHHHH..', '...hHHHHh...', '...TssssT...', '..TtTTTTtT..', '..TTtTTtTT..', '..TTTttTTT..',
  '..TTTTTTTT..', '..TTTTTTTT..', '..TTTTTTTT..', '..tttttttt..', '..LLLLLLLL..', '..LLl..lLL..', '..FFf..fFF..',
]
const SIDE = [
  '............', '............', '....HHHH....', '...HHHHHH...', '..HHHHHHHH..', '..HHHHHSSS..', '..HHHsSSES..',
  '..HHHsSSESS.', '..hHSSSSSB..', '...hSSSSMS..', '....TssT....', '...TTTTTTT..', '...TTTTTTw..', '...TTTTTTw..',
  '...TTTTTTT..', '...TTTTTTT..', '...tTTTTTt..', '...ttttttt..', '....LLLL....', '....LlLL....', '....FFFFf...',
]
const BASE: Record<View, string[]> = { front: FRONT, back: BACK, side: SIDE }
const BLANK = FRONT.map(() => '............')
const rows = (from: number, ...r: string[]) => [...Array(from).fill(''), ...r]

// haircuts, front and back (the side is put together from the two)
const HAIR = {
  crop: { front: rows(1, '....HHGH....', '...HHHHGHH..', '..HHHHHHHHH.', '..HHhHHhHH..', '..H......H..'),
    back: rows(1, '....HHGH....', '...HHHHGHH..', '..HHHHHHHHH.') },
  curls: { front: ['...HHhHHh...', '..HHHGHHHH..', '.HHhHHHHhHH.', 'HHHHHhHHHHHH', 'HhHHHHHHHHhH', 'HH........HH',
    'HH........HH', '.h........h.'],
  back: ['...HHhHHh...', '..HHHGHHHH..', '.HHhHHHHhHH.', 'HHHHHhHHHHHH', 'HhHHHHHHHHhH', 'HHHhHHHHhHHH',
    'HHHHHHHHHHHH', 'HhHHHhHHHHhH', '.HHHHHHHHHH.', '..hHHHHHHh..'] },
  bun: { front: ['....hHHh....', '....HHHH....', '...HHGHHH...', '..HHHHHHHH..', '..HH....HH..', '..H......H..'],
    back: ['....hHHh....', '....HkkH....', '...HHGHHH...'] },
  beanie: { front: ['....KKKK....', '...KKKKKK...', '..KKKKKKKK..', '..KKKKKKKK..', '..kKkKkKkK..', '..H......H..'],
    back: ['....KKKK....', '...KKKKKK...', '..KKKKKKKK..', '..KKKKKKKK..', '..KKKKKKKK..', '..kKkKkKkK..'] },
  cap: { front: ['.....kk.....', '...KKKKKK...', '..KKKKKKKK..', '..KKkHHkKK..', '..HkkkkkkH..', '..H......H..'],
    back: ['............', '...KKKKKK...', '..KKKKKKKK..', '..KKKKKKKK..', '..kkkkkkkk..', '.kkkkkkkkkk.'] },
  long: { front: rows(1, '....HHHH....', '...HHHHHH...', '..HHHHGHHH..', '..HHH..HHH..', '.HH......HH.', '.HH......HH.',
    '.HH......HH.', '.Hh......hH.', '.Hh......hH.', '.hh......hh.', '.h........h.'),
  back: rows(1, '....HHHH....', '...HHHGHH...', '..HHHHHHHH..', '..HHHHHHHH..', '..HHHHHHHH..', '..HHHHHHHH..',
    '..HHHHHHHH..', '..HHHHHHHH..', '..HHHHHHHH..', '..HhHHHHhH..', '...hHHHHh...') },
  lob: { front: rows(1, '....HHHH....', '...HGHHHH...', '..HHHHHGHH..', '..HHH..HHHH.', '.HH......HH.', '.HH......HH.',
    '.HH......HH.', '.Hh......hH.', '.hh......hh.'),
  back: rows(1, '....HHHH....', '...HHHGHH...', '..HHHHHHHH..', '..HHHHHHHH..', '..HHHHHHHH..', '..HHHHHHHH..',
    '..HHHHHHHH..', '.HHHHHHHHHH.', '.hHHhHHhHHh.') },
  buzz: { front: rows(2, '...hHHHHh...', '..hHHHHHHh..', '..h......h..'), back: [] as string[] },
  swoop: { front: rows(1, '.....HHHH...', '...HHHHGHHH.', '..HHHHHHHHH.', '..HHHHHH.h..', '..hH........'),
    back: rows(1, '.....HHHH...', '...HHHHGHHH.', '..HHHHHHHHH.') },
  puffs: { front: ['.HH......HH.', 'HGHH....HHGH', 'HHHHHHHHHHHH', '.hHHHHHHHHh.', '..HH....HH..', '..H......H..'],
    back: ['.HH......HH.', 'HGHH....HHGH', 'HHHHHHHHHHHH', '.hHHHHHHHHh.'] },
  twists: { front: ['...H.H.H.H..', '...HhHhHhH..', '..HHHHHHHHH.', '..HhHhHhHhH.', '..H.H..H.H..', '..H......H..'],
    back: ['...H.H.H.H..', '...HhHhHhH..', '..HHHHHHHHH.', '..HhHhHhHhH.'] },
} satisfies Record<HairStyle, { front: string[]; back: string[] }>
const STYLES: readonly HairStyle[] = STYLE_LIST
// from the side: the top of the head as from the front, and below the brow only what falls behind the ear
function sideOf(st: { front: string[]; back: string[] }): string[] {
  const out: string[] = []
  for (let j = 0; j < 21; j++) {
    const f = st.front[j] ?? ''
    const b = st.back[j] ?? ''
    if (j < 5) out.push([...Array(12)].map((_, i) => (f[i] && f[i] !== '.' ? f[i] : b[i] ?? '.')).join(''))
    else out.push(b.slice(0, 6))
  }
  return out
}
const PHONES = ['....QQQQ....', '...Q....Q...', '..Q......Q..', '.Q........Q.', '.Q........Q.', '.QQ......QQ.',
  '.Qq......qQ.', '.Qq......qQ.', '.QQ......QQ.']
const PHONES_SIDE = ['.....QQ.....', '....Q..Q....', '....Q.......', '....Q.......', '....Q.......', '...QQQ......',
  '...Qqq......', '...Qqq......', '...QQQ......']
const GLASSES = rows(6, '...gEggEg...')
const GLASSES_SIDE = rows(6, '.....gggEg..')
const CLEAR = rows(6, '...jEccEc...', '...cEccEc...')          // clear frames: a light outline, a glint
const CLEAR_SIDE = rows(6, '.....jccEc..', '.......cEc..')
// a cozy knit: cable ribs down the front, a ribbed hem
const KNIT = rows(10, '...TTssTT...', '..tTTttTTt..', '..TTtTTtTT..', '..tTTttTTt..', '..TTtTTtTT..', '..tTTttTTt..',
  '..TtTtTtTt..', '..tttttttt..')
const BEARD = rows(8, '..h......h..', '...hhMMhh...', '....hhhh....')
const BEARD_SIDE = rows(7, '.....h......', '.....hhhhhh.', '......hhMh..')
// arms, drawn apart from the body so they can move
const ARMS = rows(11, '.t........t.', '.T........T.', '.T........T.', '.T........T.', '.t........t.', '.S........S.')
const ARM_L = ARMS.map(r => r.slice(0, 6) + '......')
const ARM_R = ARMS.map(r => '......' + r.slice(6))
const ARMS_UP = rows(1, '.S........S.', '.T........T.', '.T........T.', '.T........T.', '.T........T.', '.T........T.',
  '.T........T.', '.T........T.', '.T........T.', '.T........T.', '.t........t.')
const SIP_DOWN = rows(11, '..........t.', '..........T.', '..........T.', '..........Tm', '..........tm', '..........Sn')
const SIP_UP = rows(8, '........mm..', '........mnS.', '..........T.', '..........t.')
const ON_PHONE = rows(6, '..P.........', '.SP.........', '.S..........', '.T..........', '.T..........', '.t..........')
// walking: the feet from the front and back, the legs and the near arm from the side
const NO_FEET = rows(19, 'xxxxxxxxxxxx', 'xxxxxxxxxxxx')
const STEP_A = rows(19, '..LLl..fFF..', '..FFf.......')
const STEP_B = rows(19, '..FFf..lLL..', '.......fFF..')
const NO_LEGS = rows(18, 'xxxxxxxxxxxx', 'xxxxxxxxxxxx', 'xxxxxxxxxxxx')
const SIDE_STEP_A = rows(18, '...LLLLL....', '..lL...LL...', '.ff....FFFf.')
const SIDE_STEP_B = rows(18, '...LLLLL....', '..LL...lL...', '.FF....fffF.')
const SIDE_ARM = rows(12, '.....t......', '.....t......', '.....t......', '.....t......', '.....S......')
const SIDE_ARM_F = rows(12, '.....t......', '.....tt.....', '......tt....', '.......tS...')
const SIDE_ARM_B = rows(12, '.....t......', '....tt......', '...tt.......', '..St........')

const SKIN = {
  fair: ['#f7d7bd', '#e6b897'], light: ['#ecb98f', '#d39a6c'], tan: ['#c98c5a', '#a96e40'],
  brown: ['#9a6038', '#7d4a2a'], deep: ['#6a3f24', '#53301c'],
} satisfies Record<Skin, [string, string]>
const skinOf = (n: Skin): [string, string] => SKIN[n] ?? SKIN.fair

function layer(base: string[], ...overs: string[][]): string[] {
  return base.map((row, j) => [...row].map((c, i) => {
    let out = c
    for (const o of overs) {
      const ch = o[j]?.[i]
      if (ch && ch !== '.') out = ch === 'x' ? '.' : ch
    }
    return out
  }).join(''))
}

function colors(l: Look): Record<string, string> {
  const [S, s] = skinOf(l.skin)
  const hat = l.hat ?? '#2b2533'
  const pants = l.pants ?? '#3d4a6b'
  const shoes = l.shoes ?? '#f1ede6'
  return { S, s, E: '#1f1426', B: mix(S, '#ff6f8f', 0.28), M: mix(s, '#7a2a3a', 0.35), H: l.hair, h: dark(l.hair, 0.3),
    G: light(l.hair, 0.22), T: l.hoodie, t: dark(l.hoodie, 0.22), w: '#f4efe6', p: dark(l.hoodie, 0.22), L: pants,
    l: dark(pants, 0.28), F: shoes, f: dark(shoes, 0.3), K: hat, k: dark(hat, 0.3), Q: '#2b2533',
    q: l.phones ?? '#a78bfa', g: '#1f1426', P: '#2b2533',
    m: '#f4efe6', n: '#cfc6d8', c: mix(S, '#ffffff', 0.55), j: '#ffffff' }
}

function hairFor(l: Look, view: View): string[][] {
  const st = HAIR[l.style] ?? HAIR.crop
  if (view === 'side') {
    const out = [sideOf(st)]
    if (l.beard) out.push(BEARD_SIDE)
    if (l.glasses) out.push(l.glasses === 'clear' ? CLEAR_SIDE : GLASSES_SIDE)
    if (l.phones) out.push(PHONES_SIDE)
    return out
  }
  const out = [st[view]]
  if (view === 'front' && l.beard) out.push(BEARD)
  if (view === 'front' && l.glasses) out.push(l.glasses === 'clear' ? CLEAR : GLASSES)
  if (l.knit) out.push(KNIT)
  if (l.phones) out.push(PHONES)
  return out
}

// A person with its top-left at x, y (feet at y + 20): the body, outlined, and the frames of a part that moves,
// each outlined only where the body leaves it bare.
function figure(x: number, y: number, l: Look, view: View, still: string[][], moving: string[][] = []): { body: string; parts: string[] } {
  const pal = colors(l)
  const body = ring(stamp(new Map(), x, y, layer(BASE[view], ...hairFor(l, view), ...still), pal))
  const parts = moving.map(p => paths(ring(stamp(new Map(), x, y, layer(BLANK, p), pal), OUT, body)))
  return { body: paths(body), parts }
}
// the eyes close for a blink now and then
function blink(x: number, y: number, l: Look, seed: number): string {
  const dur = 3.5 + (seed % 5) * 0.7
  return `<path fill="${skinOf(l.skin)[0]}" d="M${x + 4} ${y + 6}h1v1h-1zM${x + 7} ${y + 6}h1v1h-1z" opacity="0">` +
    `${window_(dur, dur - 0.18, dur)}</path>`
}

// The frames the browser copy's engine flips between: f front, b back, s side; 0 standing, 1 and 2 the steps; fs1 and
// fs2 a sip (cup down, cup up), fp on the phone, fu stretching.
const FRAMES = {
  f0: ['front', [ARMS]], f1: ['front', [ARMS, NO_FEET, STEP_A]], f2: ['front', [ARMS, NO_FEET, STEP_B]],
  b0: ['back', [ARMS]], b1: ['back', [ARMS, NO_FEET, STEP_A]], b2: ['back', [ARMS, NO_FEET, STEP_B]],
  s0: ['side', [SIDE_ARM]], s1: ['side', [SIDE_ARM_B, NO_LEGS, SIDE_STEP_A]],
  s2: ['side', [SIDE_ARM_F, NO_LEGS, SIDE_STEP_B]],
  fs1: ['front', [ARM_L, SIP_DOWN]], fs2: ['front', [ARM_L, SIP_UP]], fp: ['front', [ON_PHONE, ARM_R]],
  fu: ['front', [ARMS_UP]],
} satisfies Record<string, [View, string[][]]>
type Frame = keyof typeof FRAMES
const WALK_FRAMES: Frame[] = ['f0', 'f1', 'f2', 'b0', 'b1', 'b2', 's0', 's1', 's2']
const ALL_FRAMES = Object.keys(FRAMES) as Frame[]

function frameBuf(l: Look, k: Frame, x = 0, y = 0): Buf {
  const [view, overs] = FRAMES[k]
  return ring(stamp(new Map(), x, y, layer(BASE[view], ...hairFor(l, view), ...overs), colors(l)))
}
// a person's frames as data for the page: { skin, f: { f0: [[color, path], ...], ... } }
function spriteSet(l: Look, keys: Frame[]): { skin: string; f: Record<string, PathList> } {
  const f: Record<string, PathList> = {}
  for (const k of keys) f[k] = pathList(frameBuf(l, k))
  return { skin: skinOf(l.skin)[0], f }
}
// the same, as drawings in the page's defs, for the crew
const spriteDefs = (key: string, l: Look, keys: Frame[]) =>
  keys.map(k => `<g id="sp-${key}-${k}">${paths(frameBuf(l, k))}</g>`).join('')

// -- the pets: O the coat, o its stripes (or the fluff's shade), c cream fluff, W white (bib, mane, paws), E eyes,
// e an eye half shut (a sleepy look), N the nose, P inside the ears. Frames face right (left is the same flipped):
// w1 and w2 a walk, sit, front (sitting, facing out at the room), loaf, curl (asleep), groom, stretch, eat. Short
// hair is the slim tabby build, long hair the fluffy one.
const CAT_FRAMES: Record<CatLook['build'], Record<CatFrame, string[]>> = {
  small: {
    w1: ['o.......O..O', 'O.......OPOP', 'o.......OOEO', 'OoOoOoOoOWWN', '.OoOoOoOWWW.', '.OOOOOOOOWW.', '.W.W....W.W.'],
    w2: ['o.......O..O', 'O.......OPOP', 'o.......OOEO', 'OoOoOoOoOWWN', '.OoOoOoOWWW.', '.OOOOOOOOWW.', '..WW....WW..'],
    sit: ['......O..O..', '......OPOP..', '......OOEO..', '.o....OWWN..', 'O....OoWWW..', 'o...OoOOWW..', '.oOoOOOWWW..'],
    front: ['O...O.', 'OOOOOO', 'OEOOEO', 'OOWNWO', '.OWWWO', 'oOWWWO', '.WW.WW'],
    loaf: ['........O..O', '........OPOP', '.OoOoOoOOOEO', 'oOoOoOoOOWWN', '.OOOOOOOWWW.'],
    curl: ['.OoOoOO..', 'OoOoOoOO.', 'OOOOOOeeO', 'oOOOOOOWW', '.oOoOOWW.'],
    groom: ['............', '......O..O..', '.o....OPOP..', 'O.....OOeO..', 'o....OoWNW..', 'o...OoOWWW..', '.oOoOOOWWW..'],
    stretch: ['o...........', 'O...........', 'oOoOoOo.O..O', '.OoOoOOOOPOP', '.O...OOOOOEO', '.W....WWWWWN'],
    eat: ['o...........', 'O...........', 'oOoOoOoOo...', '.OoOoOoOOO.O', '.OOOOOOOOPOP', '.O.....OOOEO', '.W.....WWWWN'],
  },
  big: {
    w1: ['.cc............', 'cOOc......O...O', 'cOOO......OPOOP', '.cOOc.....OOeOO', '..cOOcccccOOWWN', '..OOOOOOOOOWWWc', '..OOOOOOOOOWWWW', '...oOOOoOOoWWW.', '...W.W....W.W..'],
    w2: ['.cc............', 'cOOc......O...O', 'cOOO......OPOOP', '.cOOc.....OOeOO', '..cOOcccccOOWWN', '..OOOOOOOOOWWWc', '..OOOOOOOOOWWWW', '...oOOOoOOoWWW.', '....WW....WW...'],
    sit: ['........O...O.', '........OPOOP.', '........OOeOO.', '.......cOOWWNc', '......cOWWWWWc', '.....cOOWWWWWW', '....cOOOOWWWW.', '.cc.OOOOOOWWW.', 'cOOOOOOOOcWWWc'],
    front: ['.O.....O...', '.OPOOOPO...', 'cOeeOeeOc..', 'cOOWNWOOc..', 'WWWWWWWWW..', 'cWWWWWWWc.c', 'OWWWWWWWOcO', 'OOWWWWWOOOc', '.WW...WW...'],
    loaf: ['..........O...O', '.cc.......OPOOP', 'cOOcccccccOOeOO', 'OOOOOOOOOOOOWWN', 'cOOOOOOOOOWWWWc', '.oOOoOOoOOWWWW.'],
    curl: ['...cccccc...', '.ccOOOOOOcc.', 'cOOOOOOOeeOc', 'OOOOOOOOOWWW', 'cOOOOOOOWWWc', '.cccOOOOcWc.'],
    groom: ['..............', '........O...O.', '........OPOOP.', '........OOeOO.', '......cOOWNWWc', '.....cOOWWWWWW', '....cOOOOWWWW.', '.cc.OOOOOOWWW.', 'cOOOOOOOOcWWWc'],
    stretch: ['cc.............', 'cOc............', 'cOOcccc........', '.OOOOOOOO...O.O', '..O..OOOOOOOPOP', '..O.....OOOOeOO', '..W.....WWWWWWN'],
    eat: ['.cc............', 'cOOc...........', 'cOOO...........', '.cOOcccccccc...', '..OOOOOOOOOOO.O', '..OOOOOOOOOOPOP', '...oOOOoOOOOOeO', '...W.W....WWWWN'],
  },
}
const CAT_KEYS = Object.keys(CAT_FRAMES.small) as CatFrame[]
const catPal = (c: CatLook): Record<string, string> => ({ O: c.coat, o: c.stripe, c: c.cream ?? light(c.coat, 0.4), W: c.white,
  E: c.eyes, e: dark(c.coat, 0.55), N: '#e8939a', P: '#f2b8a0' })
const catSize = (c: CatLook, k: CatFrame): Pt => {
  const f = CAT_FRAMES[c.build][k]
  return [f[0]!.length, f.length]
}
// a cat's frame with its feet's middle at x, y, outlined
function catArt(c: CatLook, k: CatFrame, x: number, y: number, pet = -1): string {
  const [w, h] = catSize(c, k)
  const b = stamp(new Map(), x - Math.floor(w / 2), y - h, CAT_FRAMES[c.build][k], catPal(c))
  const hat = pet >= 0 ? COSTUMES[SEASON]?.[pet % 2] : undefined
  if (hat) {                 // the season's costume, on the head: centered over the ears (or the eyes, curled up)
    const rows0 = CAT_FRAMES[c.build][k]
    const find = (ch: RegExp) => {
      for (let r = 0; r < rows0.length; r++) {
        const cols = [...rows0[r]!].map((v, i) => (ch.test(v) ? i : -1)).filter(i => i >= 0)
        if (cols.length) return { r, mid: (Math.min(...cols) + Math.max(...cols)) / 2 }
      }
      return undefined
    }
    const ear = find(/P/)
    const eye = find(/[Ee]/)
    const at0 = ear ? { r: ear.r - 1, mid: ear.mid } : eye ? { r: eye.r - 2, mid: eye.mid } : undefined
    if (at0) {
      const left = x - Math.floor(w / 2) + Math.round(at0.mid - (hat.rows[0]!.length - 1) / 2)
      stamp(b, left, y - h + at0.r - hat.rows.length + hat.sink, hat.rows, hat.pal)
    }
  }
  return paths(ring(b))
}
const catDefs = (id: string, c: CatLook, pet: number) =>
  CAT_KEYS.map(k => `<g id="sp-cat-${id}-${k}">${catArt(c, k, Math.floor(catSize(c, k)[0] / 2), catSize(c, k)[1], pet)}</g>`).join('')
// where a frame's open eyes are, from its top-left (midnight makes them glow)
const catEyes = (c: CatLook) => Object.fromEntries(CAT_KEYS.map(k => [k, CAT_FRAMES[c.build][k].flatMap((row, y) =>
  [...row].flatMap((ch, x) => (ch === 'E' ? [[x, y]] : [])))]))

// the season's costumes, two to a season (the first pet wears the first, the second the other, and so on): rows over
// the head, sunk `sink` rows into it
type Costume = { rows: string[]; pal: Record<string, string>; sink: number }
const COSTUMES: Record<string, Costume[]> = {
  halloween: [
    { rows: ['...k...', '..kkk..', '..kPk..', 'kkkkkkk'], pal: { k: '#6d28d9', P: '#f97316' }, sink: 1 },   // a witch's hat
    { rows: ['k.....k', 'kk...kk', 'kkk.kkk', '.kkkkk.'], pal: { k: '#2b2533' }, sink: 2 },                  // bat ears
  ],
  thanksgiving: [
    { rows: ['.kkk.', '.kYk.', 'kkkkk'], pal: { k: '#2b2533', Y: '#d4a017' }, sink: 1 },                     // a buckled hat
    { rows: ['o.r.y', '.oryo'], pal: { o: '#ea580c', r: '#b91c1c', y: '#ca8a04' }, sink: 1 },                // a leaf crown
  ],
  holiday: [
    { rows: ['....W', '..RR.', '.RRR.', 'WWWWW'], pal: { R: '#dc2626', W: '#ffffff' }, sink: 1 },              // a red hat
    { rows: ['G.G.G', '.GGG.'], pal: { G: '#16a34a' }, sink: 1 },                                             // a holly crown
  ],
}

// a pet bed, a round cushion with a rim; the bowls, blue with a pattern
function catBed(x: number, y: number, rim: string, pad: string): Item {
  return { z: y - 3, s: shadow(x - 8, y + 1, 16, 1) + art(b => {
    stamp(b, x - 8, y - 4, ['..RRRRRRRRRRRR..', '.RRPPPPPPPPPPRR.', 'RRPPPPPPPPPPPPRR', 'RRRPPPPPPPPPPRRR', '.RRRRRRRRRRRRRR.'],
      { R: rim, P: pad })
  }) }
}
function catBowl(x: number, y: number): Item {
  return { z: y + 1, s: art(b => {
    stamp(b, x, y - 3, ['.KKKK.', 'KFFFFK', 'BwBwBB', '.BBBB.'], { K: '#2f6f9a', F: '#8a5a32', B: '#3f8fc0', w: '#dff3ff' })
  }) }
}

// the cats standing still, drawn into the scene: the pane's, and the page's until its script starts
function catStatics(items: Item[], page: boolean): void {
  for (const pet of P.pets) {
    const c = petLook(pet)
    const st = P.cat.start[pet.i]!
    const sp = P.cat.spots[st.spot]!
    const [x, y] = P.cat.nodes[sp.node]!
    const [w, h] = catSize(c, st.act)
    const flip = sp.dir === 'left' && st.act !== 'front'
    const draw = page ? `<use href="#sp-cat-p${pet.i}-${st.act}" x="${x - Math.floor(w / 2)}" y="${y - h}"/>` : catArt(c, st.act, x, y, pet.i)
    const g0 = flip ? `<g transform="matrix(-1 0 0 1 ${2 * x} 0)">${draw}</g>` : draw
    items.push({ z: sp.z ?? y, s: `<g${page ? ' class="nr-static"' : ''}><title>${esc(pet.name)}</title>${g0}</g>` })
  }
}

// a pet's colors, by its coat and color
const COATS: Record<PetColor, Omit<CatLook, 'build' | 'speed'>> = {
  orange: { coat: '#e48a3a', stripe: '#b25b1f', cream: '#f6c690', white: '#fbf6ee', eyes: '#2f5d2a' },
  cream: { coat: '#e9c79a', stripe: '#c9a172', cream: '#f7e6c8', white: '#fffaf2', eyes: '#4b6b2c' },
  gray: { coat: '#8d8f9c', stripe: '#646675', cream: '#b9bbc6', white: '#f4f4f6', eyes: '#c9a227' },
  black: { coat: '#3a3544', stripe: '#28232f', cream: '#555063', white: '#f1eef5', eyes: '#e6c229' },
  brown: { coat: '#8a5a3c', stripe: '#5e3a24', cream: '#b07a52', white: '#f6efe6', eyes: '#3f7a3a' },
  white: { coat: '#f2efe9', stripe: '#d9d3c8', cream: '#ffffff', white: '#ffffff', eyes: '#4a90c2' },
}
function petLook(p: Pet): CatLook {
  const build = coatBuild(p.coat)
  return { ...COATS[p.color], build, speed: build === 'big' ? 11 : 15 }
}

// -- the people
const CLAUDE: Look = { skin: 'light', hair: '#6b3b22', style: 'crop', hoodie: '#d97757', phones: '#d97757',
  pants: '#3a3550', shoes: '#f1ede6' }
const named = (who: Crew) => `<title>${who.name ? esc(who.name) : 'A teammate'}</title>`
const HAIRS = ['#1d140f', '#2a1c14', '#4a2e1c', '#7a4322', '#8f3f1e', '#d9b36a', '#b8864b', '#4fd1c5', '#a78bfa',
  '#2a1c14', '#4a2e1c']
const HATS = ['#2b2533', '#e5e7eb', '#e4572e', '#22c55e', '#3b82f6', '#f4c542', '#a78bfa']
const AGENT_SKINS: Skin[] = ['fair', 'light', 'tan', 'brown', 'deep']
function agentLook(id: string, hoodie: string): Look {
  const h = hash(id)
  const style = STYLES[h % STYLES.length] ?? 'crop'
  return { skin: AGENT_SKINS[(h >>> 4) % AGENT_SKINS.length] ?? 'fair', hair: HAIRS[(h >>> 8) % HAIRS.length] ?? '#1d140f',
    style, hoodie, hat: HATS[(h >>> 12) % HATS.length] ?? '#2b2533', glasses: (h >>> 16) % 4 === 0,
    phones: style !== 'curls' && (h >>> 19) % 4 === 0 ? '#e5e7eb' : undefined,
    beard: (h >>> 22) % 3 === 0, pants: ['#3d4a6b', '#2b2836', '#5a5866'][(h >>> 25) % 3] ?? '#3d4a6b' }
}

// -- bubbles. An agent's says what it last said, two lines at most; one with nothing said yet thinks, its dots
// going. The regulars' chatter is smaller and lighter, so the agents stand out.
function speech(cx: number, tip: number, say: string | undefined, lo: number, hi: number): string {
  if (!say) {                                       // thinking
    const x = cx - 7
    const y = tip - 9
    let s = art(b => {
      fill(b, x, y, 14, 7, '#ffffff')
      dot(b, [[x, y], [x + 13, y], [x, y + 6], [x + 13, y + 6]], '')
      fill(b, cx - 1, y + 7, 2, 1, '#ffffff')
    })
    s = s.replace(/<path fill="" [^>]*\/>/, '')
    for (let i = 0; i < 3; i++) {
      s += `<rect x="${x + 3 + i * 3}" y="${y + 3}" width="2" height="2" fill="#5b4a86">` +
        `${anim('opacity', '.25;1;.25', 1.2, i * 0.3)}</rect>`
    }
    return s
  }
  const lines = wrap(say, 24, 2)
  const w = Math.ceil(Math.max(...lines.map(l => l.length)) * 1.98) + 6
  const h = lines.length * 4.5 + 3.5
  const x = Math.max(lo, Math.min(hi - w, Math.round(cx - w / 2)))
  const y = tip - 2 - Math.ceil(h)
  const t = Math.max(x + 3, Math.min(x + w - 4, cx))
  let s = art(b => {
    fill(b, x, y, w, Math.ceil(h), '#ffffff')
    for (const [px = 0, py = 0] of [[x, y], [x + w - 1, y], [x, y + Math.ceil(h) - 1], [x + w - 1, y + Math.ceil(h) - 1]]) b.delete(at(px, py))
    fill(b, t - 1, y + Math.ceil(h), 3, 1, '#ffffff')
    fill(b, t, y + Math.ceil(h) + 1, 1, 1, '#ffffff')
  })
  lines.forEach((line, i) => { s += text(x + 3, y + 5.1 + i * 4.5, 3.6, '#2b2342', line, ' font-weight="bold"') })
  return s
}

// -- furniture
function plant(x0: number, y0: number, tall = false): string {
  return use(tall ? 'plant2' : 'plant', x0, y0, () => {
    const x = 0
    const y = 0
    const leaves = tall
    ? ['...g.G...', '..gG.Gg..', '.gGg.gGg.', '..GgGgG..', '.gGGgGGg.', 'gGg.G.gGg', '.gGgGgGg.', '..gGGGg..', '...gGg...']
    : ['..g...g..', '.gGg.gGg.', 'gGGgGgGGg', '.gGGGGGg.', 'gGgGgGgGg', '.ggGGGgg.', '...gGg...']
  const top = y - leaves.length - 5
  return art(b => {
    stamp(b, x, top, leaves, { g: '#2f7a4a', G: '#5bb46a' })
    stamp(b, x, top + leaves.length, ['.PPPPPPP.', '.QQQQQQQ.', '..PPPPP..', '..pPPPp..', '...ppp...'],
      { P: '#d0773f', Q: '#a85a2c', p: '#a85a2c' })
    dot(b, [[x + 4, top + 2], [x + 2, top + 4], [x + 6, top + 4]], '#8fd88e')
  })
  })
}

function beanbag(x: number, y: number, c: string): { back: string; front: string } {
  const hi = light(c, 0.3)
  const sh = dark(c, 0.3)
  // the lip in front of whoever sits in it, outlined only where the bag behind doesn't already draw an edge
  const bag = ring(stamp(new Map(), x, y, ['....bbbbbbbb....', '..bBBBBBBBBBBb..', '.bBLLBBBBBBBBBb.', 'bBLLBBBBBBBBBBBb',
    'bBBBBBBBBBBBBBBb', 'bBBBBBBBBBBBBBBb', 'bbBBBBBBBBBBBBbb', '.bbbBBBBBBBBbbb.', '..bbbbbbbbbbbb..'],
  { b: sh, B: c, L: hi }))
  const lip = ring(stamp(new Map(), x, y + 5, ['bBBBBBBBBBBBBBBb', 'bbBBBBBBBBBBBBbb', '.bbbBBBBBBBBbbb.', '..bbbbbbbbbbbb..'],
    { b: sh, B: c }), OUT, bag)
  return { back: paths(bag), front: paths(lip) }
}

// a box at 3/4: a top, a front face, the light on its front edge
function block(b: Buf, x: number, y: number, w: number, d: number, h: number, top: string, face: string): Buf {
  fill(b, x, y, w, d, top)
  fill(b, x, y, w, 1, light(top, 0.25))
  fill(b, x, y + d, w, h, face)
  fill(b, x, y + d, w, 1, light(face, 0.2))
  fill(b, x, y + d + h - 1, w, 1, dark(face, 0.2))
  return b
}

const shadow = (x: number, y: number, w: number, h = 2) => rect(x, y, w, h, '#140a24', ' fill-opacity=".22" rx="1"')

// -- the walls: each room is a floor under a wall's front face, cut out of the dark wall tops
type Room = { x: number; y: number; w: number; h: number; face: number; wall: string; floor: string }

function roomShell(r: Room): string {
  const fy = r.y + r.face
  let s = rect(r.x - 1, r.y - 2, r.w + 2, 1, '#4a3670') + rect(r.x - 1, r.y - 1, r.w + 2, 1, '#120a1e')   // the wall's top
  s += rect(r.x, r.y, r.w, r.face, r.wall) + rect(r.x, r.y, r.w, r.face, 'url(#nr-paper)')
  s += rect(r.x, r.y, r.w, 1, light(r.wall, 0.3)) + rect(r.x, r.y + 1, r.w, 1, light(r.wall, 0.12))   // the crown
  s += rect(r.x, fy - 3, r.w, 1, light(r.wall, 0.18)) + rect(r.x, fy - 2, r.w, 2, dark(r.wall, 0.35))  // the baseboard
  s += rect(r.x, fy, r.w, r.h - r.face, `url(#${r.floor})`)
  s += rect(r.x, fy, r.w, 3, '#140a24', ' fill-opacity=".22"') + rect(r.x, fy, 3, r.h - r.face, '#140a24', ' fill-opacity=".14"')
  return s
}

function patterns(): string {
  const pat = (id: string, w: number, h: number, inner: string) =>
    `<pattern id="${id}" width="${w}" height="${h}" patternUnits="userSpaceOnUse">${inner}</pattern>`
  const planks = (id: string, a: string, b2: string, seam: string, grain: string) => pat(id, 24, 8,
    rect(0, 0, 24, 4, a) + rect(0, 4, 24, 4, b2) + rect(0, 3, 24, 1, seam) + rect(0, 7, 24, 1, seam) + rect(0, 0, 1, 3, seam) +
    rect(13, 4, 1, 3, seam) + rect(4, 1, 4, 1, grain) + rect(16, 5, 5, 1, grain) + rect(18, 1, 2, 1, grain))
  const tiles = (id: string, a: string, b2: string, n: number) => pat(id, n * 2, n * 2,
    rect(0, 0, n * 2, n * 2, a) + rect(n, 0, n, n, b2) + rect(0, n, n, n, b2))
  return pat('nr-paper', 4, 4, rect(0, 0, 1, 4, '#ffffff', ' fill-opacity=".05"')) +
    planks('nr-oak', '#c08a58', '#b67f4f', '#8d5f37', '#cc9866') +
    planks('nr-birch', '#e2c79a', '#d9bc8c', '#b8996b', '#ead3ab') +
    tiles('nr-carpet', '#6c6788', '#67627f', 4) +
    tiles('nr-sage', '#5e8a7f', '#59847a', 4) +
    tiles('nr-check', '#dcd0ea', '#bba8d8', 6) +
    pat('nr-lobby', 16, 8, rect(0, 0, 16, 8, '#a493c9') + rect(0, 0, 8, 4, '#9a88c0') + rect(8, 4, 8, 4, '#9a88c0') +
      rect(0, 7, 16, 1, '#8a78b2') + rect(7, 0, 1, 8, '#8a78b2') + rect(1, 1, 3, 1, '#b3a4d4')) +
    pat('nr-turf', 8, 4, rect(0, 0, 8, 4, '#3f8f4f') + rect(0, 0, 8, 2, '#469a57') + rect(3, 1, 1, 1, '#55aa64')) +
    planks('nr-walnut', '#8a5a3c', '#815436', '#5e3a24', '#9a6a48') +
    pat('nr-stone', 12, 12, rect(0, 0, 12, 12, '#d3c9e3') + rect(0, 11, 12, 1, '#b4a8cb') + rect(11, 0, 1, 12, '#b4a8cb') +
      rect(1, 1, 3, 1, '#ded6eb')) +
    pat('nr-den', 6, 6, rect(0, 0, 6, 6, '#1d1830') + rect(0, 0, 3, 3, '#211b37') + rect(3, 3, 3, 3, '#211b37')) +
    tiles('nr-board', '#3b3f63', '#373b5d', 4)
}

function glows(): string {
  const radial = (id: string, c: string, o = 0.55) =>
    `<radialGradient id="${id}"><stop offset="0" stop-color="${c}" stop-opacity="${o}"/>` +
    `<stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`
  return P.depts.map(d => radial(`nr-halo-${d.id}`, light(d.color, 0.15), 0.7)).join('') +
    radial('nr-warm', '#ffd9a0', 0.4) + radial('nr-screen', '#8f7bff', 0.5) + radial('nr-cyan', '#7fe3ff', 0.35) +
    `<filter id="nr-blur" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="1.2"/></filter>` +
    `<radialGradient id="nr-vignette" cx=".5" cy=".5" r=".75"><stop offset=".6" stop-color="#140a24" stop-opacity="0"/>` +
    `<stop offset="1" stop-color="#140a24" stop-opacity=".35"/></radialGradient>` +
    `<linearGradient id="nr-led"><stop offset="0" stop-color="#ff4fd8"/><stop offset=".33" stop-color="#6d5bff"/>` +
    `<stop offset=".66" stop-color="#2ee6d6"/><stop offset="1" stop-color="#ff4fd8"/></linearGradient>`
}

// -- the season (clock.ts, by this machine's date; none when the config turns the seasons off) and the night's lamps.
// A lamp's light and a carved pumpkin's glow go in LIGHTS, drawn over the night's tint: the page shows them when its
// sky is night (CSS), the pane only at night.
let SEASON: Season = ''
let NIGHT = false
let LIGHTS: string[] = []
let TOP: string[] = []             // drawn over the stage, under the night's tint: the conference room's dimness
function lightUp(glow: string): void {
  if (MODE === 'page') LIGHTS.push(g(glow, ' class="nr-glow"'))
  else if (NIGHT) LIGHTS.push(glow)
}
// a desk lamp: a small shade on a stand, its bulb, a warm pool of light at night
function lamp(x: number, y: number, z: number, shade = '#2f4a7a'): Item[] {
  if (LITE) return []
  const body = art(b => stamp(b, x, y, ['.ttt.', 'ttttt', '..p..', '..p..', '.ppp.'], { t: shade, p: '#3a3352' }))
  lightUp(`<path d="M${x + 0.5} ${y + 2}h4l3 6h-10z" fill="#ffe9a8" opacity=".34"/>` +
    `<ellipse cx="${x + 2.5}" cy="${y + 8}" rx="6" ry="2" fill="#ffe9a8" opacity=".3"/>` +
    `<ellipse cx="${x + 2.5}" cy="${y + 4}" rx="15" ry="11" fill="url(#nr-warm)"/>` + rect(x + 1, y + 2, 3, 1, '#fff3b0'))
  return [{ z, s: body }]
}
// Halloween's carved pumpkins (glowing at night), Thanksgiving's plain ones
function pumpkin(x: number, y: number, carved: boolean, big = false): Item[] {
  if (LITE) return []
  const rows0 = big ? ['....s....', '..OOsOO..', '.OOoOOoO.', 'OOoOOOoOO', 'OOoOOOoOO', 'OOoOOOoOO', '.OOoOoOO.', '..OOOOO..']
    : ['...s...', '.OOsOO.', 'OOoOOoO', 'OoOOOoO', 'OOoOOoO', '.OOOOO.']
  const face = big ? ['', '', '', '.YY...YY.', '..Y...Y..', '', '..YYYYY..', '...Y.Y...'] : ['', '', '.Y...Y.', '', '.YYYYY.', '']
  const h = rows0.length
  const body = art(b => {
    stamp(b, x, y - h, rows0, { O: '#f97316', o: '#c2410c', s: '#3f6212' })
    if (carved) stamp(b, x, y - h, face, { Y: '#ffd166' })
  })
  if (carved) lightUp(`<ellipse cx="${x + rows0[0]!.length / 2}" cy="${y - h / 2}" rx="${big ? 11 : 8}" ry="${big ? 8 : 6}" fill="url(#nr-warm)"/>`)
  return [{ z: y, s: shadow(x, y, rows0[0]!.length, 1) + body }]
}
const autumn = () => SEASON === 'halloween' || SEASON === 'thanksgiving'
// the holidays' tree, its bulbs twinkling
function holidayTree(x: number, y: number): Item {
  const rows0 = ['....Y....', '....g....', '...gGg...', '..gGgGg..', '...gGg...', '..gGgGg..', '.gGgGgGg.', '..gGgGg..', '.gGgGgGg.',
    'gGgGgGgGg', '....t....', '...rrr...']
  const top = y - rows0.length
  let s = shadow(x, y, 9, 1) + art(b => stamp(b, x, top, rows0, { Y: '#fde047', g: '#166534', G: '#22c55e', t: '#7c4a24', r: '#b91c1c' }))
  const bulbs: [number, number, string][] = [[3, 3, '#ef4444'], [5, 5, '#60a5fa'], [2, 6, '#f4c542'], [6, 7, '#ef4444'], [3, 8, '#22d3ee'],
    [7, 9, '#f4c542'], [1, 9, '#ef4444'], [4, 7, '#f472b6']]
  bulbs.forEach(([dx, dy, c], i) => {
    s += `<rect x="${x + dx}" y="${top + dy}" width="1" height="1" fill="${c}">${anim('opacity', '1;.3;1', 1.4 + (i % 3) * 0.4, i * 0.2)}</rect>`
  })
  return { z: y, s }
}

// string lights along the top of a wall, the bulbs twinkling by color (the season's colors when there is one)
const SEASON_BULBS: Record<string, string[]> = {
  halloween: ['#ff8c1a', '#a855f7', '#ffb347', '#84cc16'],
  thanksgiving: ['#f59e0b', '#dc2626', '#ca8a04', '#ea580c'],
  holiday: ['#ef4444', '#22c55e', '#f4c542', '#60a5fa'],
}
function stringLights(x: number, y: number, w: number): string {
  const bulbs = SEASON_BULBS[SEASON] ?? ['#ffd27a', '#ff9bd2', '#9be7ff', '#c4f59b']
  const n = Math.floor(w / 7)
  let s = `<path d="M${x} ${y}` + [...Array(n)].map((_, i) => `Q${x + i * 7 + 3.5} ${y + 3} ${x + (i + 1) * 7} ${y}`).join('') +
    `" stroke="#120a1e" stroke-width=".6" fill="none" shape-rendering="auto"/>`
  for (let c = 0; c < 4; c++) {
    const pts: number[][] = []
    for (let i = c; i < n; i += 4) pts.push([x + i * 7 + 3, y + 2])
    s += `<g>${anim('opacity', '1;.45;1', 2 + c * 0.6, c * 0.5)}${art(b => { for (const [px = 0, py = 0] of pts) fill(b, px, py, 1, 2, bulbs[c] ?? '#ffd27a') }, false)}</g>`
  }
  return s
}

// pennants strung along a wall's top, in bright colors
function pennants(x: number, y: number, w: number): string {
  const cols = ['#7c3aed', '#14b8a6', '#f59e0b', '#ec4899', '#a78bfa']
  let s = `<path d="M${x} ${y + 1}Q${x + w / 2} ${y + 4} ${x + w} ${y + 1}" stroke="#120a1e" stroke-width=".6" fill="none" shape-rendering="auto"/>`
  s += art(b => {
    for (let i = 0, px = x + 2; px + 5 < x + w; i++, px += 7) {
      const t = (px - x) / w
      const sag = Math.round(1 + 3 * t * (1 - t) * 2)
      stamp(b, px, y + sag, ['PPPPP', '.PPP.', '..P..'], { P: cols[i % cols.length]! })
    }
  }, false)
  return s
}

function windowOn(x: number, y: number, sky: string, w = 16): string {
  const day = sky === 'day'
  const night = sky === 'night'
  let s = art(b => {
    fill(b, x, y, w, 12, '#efe9f6')
    fill(b, x + 1, y + 1, w - 2, 5, day ? '#8fcdf2' : night ? '#141d45' : '#e98a6e')
    fill(b, x + 1, y + 6, w - 2, 5, day ? '#bfe5fb' : night ? '#24306a' : '#f6bb72')
    fill(b, x + w / 2 - 1, y + 1, 1, 10, '#efe9f6')
    if (day) fill(b, x + 2, y + 3, 4, 1, '#ffffff').set(at(x + 3, y + 2), '#ffffff')
    if (day) fill(b, x + w - 6, y + 7, 3, 1, '#ffffff')
    if (night) dot(b, [[x + w - 4, y + 2], [x + w - 4, y + 3], [x + w - 5, y + 2]], '#fff3c4')
    fill(b, x - 1, y + 12, w + 2, 1, '#f8f5fb')
    fill(b, x - 1, y + 13, w + 2, 1, '#c9bfd9')
  })
  if (night) {
    s += `<path fill="#fff7c2" d="M${x + 3} ${y + 3}h1v1h-1zM${x + w - 5} ${y + 8}h1v1h-1zM${x + 5} ${y + 9}h1v1h-1z">` +
      `${anim('opacity', '1;.3;1', 2.6)}</path>`
  }
  return s
}

// the light from a window, falling down and across the floor
function sunlight(x: number, fy: number, sky: string, w = 16): string {
  const c = sky === 'day' ? '#fff3cf' : sky === 'night' ? '#9fb2ff' : '#ffb27a'
  const o = sky === 'night' ? 0.06 : 0.16
  return `<path d="M${x} ${fy}h${w}l9 26h${-w}z" fill="${c}" fill-opacity="${o}"/>`
}

function sign(x: number, y: number, label: string, color: string, extra: number): string {
  const w = Math.ceil(label.length * 2.2) + 5
  const ink = inkOn(color)
  let s = art(b => {
    fill(b, x, y, w, 7, color)
    fill(b, x, y, w, 1, light(color, 0.3))
    fill(b, x, y + 6, w, 1, dark(color, 0.25))
  })
  s += text(x + w / 2, y + 5.3, 4, ink, label, ' text-anchor="middle" font-weight="bold"')
  if (extra > 0) {
    const label2 = `+${extra}`
    const w2 = Math.ceil(label2.length * 2.2) + 4
    s += art(b => fill(b, x + w + 1, y + 1, w2, 6, '#ffffff')) +
      text(x + w + 1 + w2 / 2, y + 5.4, 3.6, '#2b2342', label2, ' text-anchor="middle" font-weight="bold"')
  }
  return s
}

// a workstation's parts: the chair, in its department's color (taller and darker when taken), and a stretch of the
// room's long wooden bench with a monitor seen from behind, its power light in the department's color
const chairOn = (cx: number, dt: number, color: string) => use(`chair-${color.slice(1)}`, cx, dt, () => art(b => {
  const c = mix(color, '#241a3a', 0.55)
  fill(b, -10, -9, 12, 9, c)
  fill(b, -9, -8, 10, 1, light(c, 0.25))
  fill(b, -10, -1, 12, 1, dark(c, 0.3))
  b.delete(at(-10, -9))
  b.delete(at(1, -9))
}))
const chairOff = (cx: number, dt: number, color: string) => use(`chair0-${color.slice(1)}`, cx, dt, () => art(b => {
  const c = mix(color, '#6e6596', 0.6)
  fill(b, -9, -6, 11, 6, c)
  fill(b, -8, -5, 9, 1, light(c, 0.25))
  b.delete(at(-9, -6))
  b.delete(at(1, -6))
}))
const deskUse = (cx: number, dt: number, color: string) => use(`desk-${color.slice(1)}`, cx, dt, () => art(b => {
  block(b, -10, 0, 21, 5, 5, '#d9a877', '#8f5f3c')
  fill(b, -10, 9, 21, 1, '#6f4529')
  fill(b, 4, -6, 6, 5, '#3a3150')
  fill(b, 5, -5, 4, 1, '#51476d')
  fill(b, 6, -1, 2, 2, '#2c2540')
  b.set(at(8, -2), color)
}))
// the clutter a seat keeps on its bench: a mug, a can, a tiny plant, a rubber duck, a stack of notes
function clutter(cx: number, dt: number, seed: number): string {
  const x = cx - 10
  const kinds = [
    () => art(b => { fill(b, x, dt - 1, 2, 3, '#fffdf6'); b.set(at(x + 2, dt), '#fffdf6'); b.set(at(x, dt - 1), '#c9c2d6') }),
    () => art(b => { fill(b, x, dt - 2, 2, 3, '#ef4444'); fill(b, x, dt - 2, 2, 1, '#c9cdd8') }),
    () => art(b => { stamp(b, x, dt - 4, ['.g.', 'gGg', '.g.', 'PPP', '.P.'], { g: '#2f7a4a', G: '#5bb46a', P: '#d0773f' }) }),
    () => art(b => { stamp(b, x, dt - 3, ['.yy.', '.yko', 'yyy.', 'yyyy'], { y: '#f4c542', k: '#1f1426', o: '#f97316' }) }),
    () => art(b => { fill(b, x, dt, 4, 1, '#fffdf6'); fill(b, x, dt + 1, 4, 1, '#fde68a') }),
  ]
  return kinds[seed % kinds.length]!()
}

// a tool tag's type size: smaller for the long words, so every one fits its desk
const tagFont = (t: string) => (t.length > 8 ? 3.1 : 3.5)

// -- a workstation: a desk, a chair, a monitor seen from behind. An agent at it glows in its department's color,
// types, and wears a tag with its latest tool; a free one holds the reports of the agents who've handed back.
function workstation(cx: number, dt: number, d: Dept, who: Staffer | undefined, piles: number): string {
  const color = d.color
  let s = ''
  const ax = cx - 2                                  // the agent's middle
  if (who) {
    s += `<ellipse cx="${ax}" cy="${dt - 7}" rx="13" ry="12" fill="url(#nr-halo-${d.id})">${anim('opacity', '.6;1;.6', 2.4)}</ellipse>`
    s += chairOn(cx, dt, color)
    const l = agentLook(who.id, color)
    const x = cx - 8
    const y = dt - 16
    s += figure(x, y, l, 'front', [ARMS]).body + blink(x, y, l, hash(who.id))
  } else s += chairOff(cx, dt, color)
  s += deskUse(cx, dt, color) + clutter(cx, dt, hash(`${d.id}${cx}`))
  s += rect(cx - 7, dt + 1, 8, 1, who ? '#3d3654' : '#efe2cf')         // the keyboard
  if (who) {
    s += `<rect x="${cx + 3}" y="${dt - 6}" width="1" height="5" fill="#9be8ff">${anim('opacity', '.9;.5;.9;.8;.9', 2.2)}</rect>` +
      rect(cx - 7, dt + 1, 11, 3, '#9be8ff', ' fill-opacity=".14"')
    const skin = skinOf(agentLook(who.id, color).skin)[0]
    for (const [hx, ph] of [[cx - 8, 0], [cx, 0.18]]) {
      s += `<rect x="${hx}" y="${dt}" width="2" height="1" fill="${skin}">${anim('y', `${dt};${dt - 1};${dt}`, 0.36, ph)}</rect>`
    }
    const tool = toolLabel(who.tool)
    if (tool) {
      const fs = tagFont(tool)
      const w = Math.ceil(tool.length * fs * 0.55) + 3
      const ink = d.ink
      s += art(b => fill(b, cx - Math.ceil(w / 2), dt + 5, w, 5, color)) +
        text(cx, dt + 9, fs, ink, tool, ' text-anchor="middle" font-weight="bold"')
    }
  } else if (piles > 0) {
    const n = Math.min(piles, 4)
    s += art(b => {
      fill(b, cx - 8, dt + 1 - n, 7, 3, '#fffdf6')
      fill(b, cx - 7, dt + 2 - n, 4, 1, '#c9c2d6')
      for (let i = 0; i < n; i++) fill(b, cx - 8, dt + 4 - n + i, 7, 1, i % 2 ? '#d9d2e6' : '#f1ecf8')
    })
  }
  return s + shadow(cx - 10, dt + 11, 20, 1)
}

// -- the regulars at their pastimes. Each returns its drawing, and its feet's y for sorting.
type Item = { z: number; s: string }

function standing(x: number, feet: number, who: Crew, act: 'idle' | 'sip' | 'phone' | 'stretch', seed: number,
  view: View = 'front'): Item {
  const l = who.look
  const y = feet - 20
  let s = shadow(x + 2, feet, 8, 1)
  if (act === 'sip') {
    const f = figure(x, y, l, view, [ARM_L], [SIP_DOWN, SIP_UP])
    const dur = 6 + (seed % 3)
    s += f.body + `<g>${steps(dur, [[0, 1], [dur - 1.6, 0]], seed % 2)}${f.parts[0]}</g>`
    s += `<g opacity="0">${steps(dur, [[0, 0], [dur - 1.6, 1]], seed % 2)}${f.parts[1]}</g>`
    for (let i = 0; i < 2; i++) {
      s += `<rect x="${x + 11 + i}" y="${y + 13}" width="1" height="1" fill="#ffffff" opacity="0">` +
        `${anim('y', `${y + 13};${y + 8}`, 1.8, i * 0.9)}${anim('opacity', '.8;0', 1.8, i * 0.9)}</rect>`
    }
  } else if (act === 'stretch') {
    const f = figure(x, y, l, view, [], [ARMS, ARMS_UP])
    const dur = 5 + (seed % 3)
    s += f.body + `<g>${steps(dur, [[0, 1], [dur - 1.8, 0]])}${f.parts[0]}</g>` +
      `<g opacity="0">${steps(dur, [[0, 0], [dur - 1.8, 1]])}${f.parts[1]}</g>`
  } else if (act === 'phone') {
    s += figure(x, y, l, view, [ON_PHONE, ARM_R]).body
  } else {
    s += figure(x, y, l, view, [ARMS]).body
  }
  if (view === 'front') s += blink(x, y, l, seed)
  return { z: feet, s: `<g>${named(who)}${s}</g>` }
}

// someone on a beanbag, typing on a laptop on their lap
function lounging(x: number, y: number, who: Crew, bag: string): Item {
  const l = who.look
  const b = beanbag(x, y + 10, bag)
  const f = figure(x + 2, y - 2, l, 'front', [])
  let s = shadow(x + 1, y + 19, 15, 1) + b.back + f.body + blink(x + 2, y - 2, l, 7) + b.front
  s += art(bb => {                                    // the laptop, its back to us
    fill(bb, x + 4, y + 9, 8, 5, '#c9cdd8')
    fill(bb, x + 4, y + 13, 8, 1, '#a9adba')
    dot(bb, [[x + 7, y + 11], [x + 8, y + 11]], '#a78bfa')
  })
  for (const [hx, ph] of [[x + 3, 0], [x + 12, 0.2]]) {
    s += `<rect x="${hx}" y="${y + 12}" width="1" height="2" fill="${skinOf(l.skin)[0]}">${anim('y', `${y + 12};${y + 11};${y + 12}`, 0.4, ph)}</rect>`
  }
  return { z: y + 18, s: `<g>${named(who)}${s}</g>` }
}

function whiteboard(x: number, y: number): string {
  let s = art(b => {
    fill(b, x, y, 19, 12, '#f7f5f0')
    fill(b, x, y + 11, 19, 1, '#d9d4e2')
    fill(b, x + 2, y + 2, 1, 8, '#9a93ad')
    fill(b, x + 2, y + 9, 15, 1, '#9a93ad')
    const pts = [[4, 8], [5, 8], [6, 7], [7, 7], [8, 6], [9, 7], [10, 6], [11, 5], [12, 5], [13, 4], [14, 4], [15, 3], [16, 3]]
    dot(b, pts.map(([i = 0, j = 0]) => [x + i, y + j]), '#7c3aed')
    fill(b, x + 5, y + 12, 6, 1, '#a39cb5')
  })
  s += `<rect x="${x + 16}" y="${y + 2}" width="2" height="2" fill="#ec4899">${anim('opacity', '1;.2;1', 1.4)}</rect>`
  return s
}

// a clipboard with its checklist, a magnifying glass over it
function clipboard(x: number, y: number): string {
  let s = art(b => {
    fill(b, x, y, 10, 15, '#b07a45')
    fill(b, x + 1, y + 2, 8, 12, '#fffdf6')
    fill(b, x + 3, y - 1, 4, 3, '#9aa0ad')
    for (let i = 0; i < 4; i++) {
      fill(b, x + 5, y + 4 + i * 3, 3, 1, '#c9c2d6')
      dot(b, i === 2 ? [[x + 2, y + 3 + i * 3], [x + 4, y + 3 + i * 3], [x + 3, y + 4 + i * 3], [x + 2, y + 5 + i * 3], [x + 4, y + 5 + i * 3]]
        : [[x + 2, y + 4 + i * 3], [x + 3, y + 5 + i * 3], [x + 4, y + 3 + i * 3]], i === 2 ? '#ef4444' : '#16a34a')
    }
  })
  s += art(b => {                                    // the magnifying glass
    stamp(b, x + 3, y + 6, ['.ggg..', 'gLLLg.', 'gLWLg.', 'gLLLg.', '.gggh.', '....hh', '.....h'],
      { g: '#3a3352', L: '#cdeffd', W: '#ffffff', h: '#7a4a24' })
  })
  s += `<rect x="${x + 5}" y="${y + 7}" width="1" height="1" fill="#ffffff">${anim('opacity', '0;1;0', 2.2)}</rect>`
  return s
}

function swatches(x: number, y: number): string {
  return art(b => {
    fill(b, x, y, 16, 10, '#fffdf6')
    ;['#f59e0b', '#7c3aed', '#ec4899', '#14b8a6'].forEach((c, i) => {
      fill(b, x + 1 + i * 4, y + 1, 3, 6, c)
      fill(b, x + 1 + i * 4, y + 8, 3, 1, '#c9c2d6')
    })
  })
}

function clock(x: number, y: number, t?: { hour: number; minute: number }): string {
  return art(b => {
    for (let j = 0; j < 13; j++) {
      for (let i = 0; i < 13; i++) {
        const d = (i - 6) ** 2 + (j - 6) ** 2
        if (d <= 40) b.set(at(x + i, y + j), d > 27 ? '#d9d4e2' : '#fffdf6')
      }
    }
    dot(b, [[x + 6, y + 2], [x + 10, y + 6], [x + 6, y + 10], [x + 2, y + 6]], '#9a93ad')
    if (t) clockHands(b, x, y, t)                   // the page draws its own, in #nr-hands
  })
}
function clockHands(b: Buf, x: number, y: number, t: { hour: number; minute: number }): Buf {
  const hand = (a: number, len: number, c: string) => {
    for (let k = 1; k <= len; k++) b.set(at(x + 6 + Math.round(Math.sin(a) * k), y + 6 - Math.round(Math.cos(a) * k)), c)
  }
  hand(t.minute / 60 * 2 * Math.PI, 5, '#6b6385')
  hand(((t.hour % 12) + t.minute / 60) / 12 * 2 * Math.PI, 3, '#2b2342')
  return b.set(at(x + 6, y + 6), '#ef4444')
}

// the sky outside a window: in the pane, as it is now; in the page, all three, the page showing the one that fits
function skies(sky: string, draw: (k: string) => string): string {
  if (MODE === 'pane') return draw(sky)
  return ['day', 'dusk', 'night'].map(k => g(draw(k), ` class="sky-${k}"`)).join('')
}

// a kanban board: cards in columns, the last few still to do
function kanban(x: number, y: number): string {
  const tags = ['#ef4444', '#22c55e', '#3b82f6', '#f59e0b', '#22c55e', '#3b82f6']
  let s = art(b => {
    fill(b, x, y, 29, 14, '#23202f')
    fill(b, x, y, 29, 2, '#3a3352')
    for (let c = 0; c < 6; c++) fill(b, x + 2 + c * 4 + 1, y + 1, 2, 1, '#c4b5fd')
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 6; c++) {
        if (r === 3 && c > 2) continue
        fill(b, x + 2 + c * 4, y + 3 + r * 3, 3, 2, tags[(r * 5 + c * 7) % tags.length] ?? '#ef4444')
      }
    }
  })
  s += `<rect x="${x + 14}" y="${y + 12}" width="3" height="2" fill="#fff7c2">${anim('opacity', '1;.15;1', 1.6)}</rect>`
  return s
}
// a framed heart, pink on a dark board
function heartFrame(x: number, y: number): string {
  return art(b => {
    fill(b, x, y + 2, 9, 9, '#2b2342')
    stamp(b, x + 1, y + 3, ['.HH.HH.', 'HHHHHHH', 'HHHHHHH', '.HHHHH.', '..HHH..', '...H...'], { H: '#ec4899' })
  })
}

// -- the department rooms: a shell in the room's look; its wall decor by theme, fitted between its sign and its
// right wall; its workstations along the back; the staff's desks in front; a plant in the corner
type WallItem = { w: number; draw: (x: number, y: number) => string }
function wallItems(d: Dept, sky: string): WallItem[] {
  const fy = d.y + d.face
  const win = (w: number): WallItem => ({ w, draw: (x, y) => skies(sky, k => windowOn(x, y + 1, k, w) + sunlight(x, fy, k, w)) })
  switch (d.theme) {
    case 0: return [win(16), { w: 29, draw: kanban }, win(14)]
    case 1: return [{ w: 19, draw: whiteboard }, { w: 10, draw: clipboard }]
    case 2: return [{ w: 16, draw: (x, y) => swatches(x, y + 2) }, { w: 9, draw: heartFrame }]
    default: return [{ w: 17, draw: moodBoard }, win(14)]
  }
}

function deptRoom(d: Dept, here: Staffer[], handed: number, sky: string, over: string[], items: Item[]): string {
  const r: Room = { x: d.x, y: d.y, w: d.w, h: d.h, face: d.face, wall: d.wall, floor: d.floor }
  const fy = r.y + r.face
  const dt = deskTop(d)
  const hy = homeY(d)
  let s = roomShell(r)
  if (d.theme === 2) s += stringLights(r.x, r.y + 2, r.w)
  const extra = MODE === 'page' ? 0 : here.length - d.seats
  const min = r.x + 3 + Math.ceil(d.label.length * 2.2) + 5 + (extra > 0 ? 12 : 0) + 4
  const lastLower = !d.tall && d.y > 50 && d.x + d.w === 162 + P.OX     // its doorway takes the wall's right end
  let cursor = r.x + r.w - (lastLower ? 15 : 4)
  for (const it of [...wallItems(d, sky)].reverse()) {
    if (cursor - it.w < min) continue
    cursor -= it.w
    s += it.draw(cursor, r.y + 2)
    cursor -= 5
  }
  // the floor: a rug under the staff's desks, a warm light in the review-style rooms, a sitting corner in a tall room
  s += `<ellipse cx="${r.x + r.w / 2 - 3}" cy="${hy - 4}" rx="${Math.round(r.w / 2 - 8)}" ry="8" fill="${dark(d.color, 0.55)}" opacity=".35"/>`
  if (d.theme === 1) s += `<ellipse cx="${r.x + r.w / 2}" cy="${fy + 22}" rx="${Math.round(r.w / 2 - 4)}" ry="9" fill="url(#nr-warm)"/>`
  if (d.tall) {
    const cy = r.y + r.h - 36
    s += `<ellipse cx="${r.x + r.w / 2 - 3}" cy="${cy}" rx="${Math.round(r.w / 2 - 16)}" ry="13" fill="${light(d.color, 0.2)}" opacity=".22"/>` +
      `<ellipse cx="${r.x + r.w / 2 - 3}" cy="${cy}" rx="${Math.round(r.w / 2 - 22)}" ry="9" fill="${light(d.color, 0.4)}" opacity=".18"/>`
    items.push({ z: r.y + r.h - 1, s: plant(r.x + 3, r.y + r.h - 1, true) })
  }
  // the last column's lower room: its doorway up to the room above
  if (lastLower) {
    const ox = r.x + r.w - 11
    s += rect(ox, r.y - 3, 10, r.face + 3, '#6c6788') + rect(ox, r.y - 3, 10, r.face + 3, 'url(#nr-carpet)') +
      rect(ox, r.y - 3, 10, 3, '#140a24', ' fill-opacity=".35"') +
      rect(ox - 1, r.y + 1, 1, r.face, '#8a5a34') + rect(ox + 10, r.y + 1, 1, r.face, '#8a5a34') + rect(ox - 1, r.y + 1, 12, 1, '#a8704a')
  }
  s += sign(r.x + 3, r.y + 2, d.label, d.color, extra)
  // the workstations, and the bubbles over the agents at them: with two or more, they take turns
  const seats = here.slice(0, d.seats)
  for (let i = 0; i < d.seats; i++) {
    const cx = seatX(d, i)
    if (MODE === 'page') {                   // the page: seats the engine fills, drawn taken for whoever is here now,
      const who = seats[i]                   // so the office shows its agents without the script too
      items.push(...seatPage(cx, dt, d, i, who))
      if (who) {
        const l = agentLook(who.id, d.color)
        items.push({ z: dt + 4, s: `<g class="nr-static">${figure(cx - 8, dt - 16, l, 'front', [ARMS]).body}</g>` })
        if (i === 0) over.push(`<g class="nr-static">${speech(cx - 2, dt - 15, who.say ? plain(who.say) : undefined, r.x + 1, r.x + r.w - 1)}</g>`)
      }
      continue
    }
    const who = seats[i]
    const free = d.seats - seats.length
    const k = i - seats.length
    const piles = who || k < 0 ? 0 : Math.ceil(Math.max(0, handed - k) / free)
    const tip = who ? `<title>${esc(who.task.slice(0, 240))}${who.say ? `\n“${esc(who.say)}”` : ''}</title>` : ''
    items.push({ z: dt + 10, s: `<g>${tip}${workstation(cx, dt, d, who, piles)}</g>` })
    if (who) {
      const b = speech(cx - 2, dt - 15, who.say ? plain(who.say) : undefined, r.x + 1, r.x + r.w - 1)
      const n = seats.length
      if (n === 1) over.push(`<g>${tip}${b}</g>`)
      else over.push(`<g opacity="${i === 0 ? 1 : 0}">${tip}${window_(n * 4, i * 4, i * 4 + 4)}${b}</g>`)
    }
  }
  // the staff's own desks (a beanbag for whoever works lounging), and a plant in the corner
  for (const c of P.crew) {
    if (c.dept !== d) continue
    if (c.pose === 'type') items.push(standDesk(c.x, hy, d.color), ...lamp(c.x - 9, hy - 13, hy + 4.5))
    else if (MODE === 'page' || LITE) items.push(...bagItems(c.x, hy, '#a78bfa'))
  }
  items.push({ z: r.y + r.h - 1, s: plant(r.x + r.w - 12, r.y + r.h - 1, d.theme % 2 === 0) })
  if (autumn() && d.i === 0) items.push(...pumpkin(r.x + r.w - 22, r.y + r.h - 2, SEASON === 'halloween'))
  return s
}

// a mood board of pinned cards and swatches, a heart that beats
function moodBoard(x: number, y: number): string {
  let s = art(b => {
    fill(b, x, y, 17, 13, '#c99a62')
    fill(b, x, y, 17, 1, '#ddb37f')
    fill(b, x + 1, y + 2, 5, 4, '#fffdf6')
    fill(b, x + 2, y + 3, 3, 2, '#f4b6c2')
    fill(b, x + 7, y + 2, 4, 5, '#a7f3d0')
    fill(b, x + 12, y + 2, 4, 4, '#fde68a')
    fill(b, x + 1, y + 7, 4, 5, '#c4b5fd')
    fill(b, x + 6, y + 8, 6, 4, '#fffdf6')
    dot(b, [[x + 7, y + 10], [x + 8, y + 9], [x + 9, y + 10], [x + 10, y + 9]], '#14b8a6')
    fill(b, x + 13, y + 7, 3, 5, '#f9a8d4')
    dot(b, [[x + 3, y + 2], [x + 9, y + 2], [x + 14, y + 2], [x + 3, y + 7], [x + 9, y + 8], [x + 14, y + 7]], '#ef4444')
  })
  s += `<path d="M${x + 13} ${y + 8}h1v1h1v-1h1v2h-1v1h-1v-1h-1z" fill="#ec4899">${anim('opacity', '1;.35;1', 1.3)}</path>`
  return s
}

// an empty beanbag, its back and its front lip apart, so whoever sits in it sits between them
function bagItems(fx: number, F: number, c: string): Item[] {
  const b = beanbag(fx - 8, F - 8, c)
  return [{ z: F - 1, s: shadow(fx - 7, F + 1, 15, 1) + b.back }, { z: F + 1, s: b.front }]
}

// a crew desk: a standing desk with a laptop, its lid to us; whoever works at it stands behind it
function standDesk(fx: number, F: number, lid: string): Item {
  const x = fx - 9
  return { z: F + 4, s: shadow(x, F + 3, 18, 1) + art(b => {
    fill(b, x + 1, F - 2, 1, 5, '#6b4a2e')
    fill(b, x + 16, F - 2, 1, 5, '#6b4a2e')
    block(b, x, F - 8, 18, 3, 3, '#d9b98c', '#a87c4f')
    fill(b, fx + 4, F - 12, 6, 4, '#c9cdd8')
    fill(b, fx + 4, F - 9, 6, 1, '#a9adba')
    dot(b, [[fx + 6, F - 11], [fx + 7, F - 11]], lid)
  }) }
}

// a workstation in the page: the chair, and the desk in front of whoever sits in it, each in two states the page
// switches between (free, and taken: the halo, the screen's glow, the tool tag)
function seatPage(cx: number, dt: number, d: Dept, i: number, who?: Staffer): Item[] {
  const id = `${d.id}-${i}`
  const ink = d.ink
  const on = who ? ' on' : ''
  const tool = who ? toolLabel(who.tool) : ''
  const fs = tagFont(tool)
  const tw = Math.ceil(tool.length * fs * 0.55) + 3
  const chair = `<g class="nr-seat${on}" data-seat="${id}"><g class="nr-on">` +
    `<ellipse cx="${cx - 2}" cy="${dt - 7}" rx="13" ry="12" fill="url(#nr-halo-${d.id})">${anim('opacity', '.6;1;.6', 2.4)}</ellipse>` +
    `${chairOn(cx, dt, d.color)}</g><g class="nr-off">${chairOff(cx, dt, d.color)}</g></g>`
  const desk = `<g class="nr-seat${on}" data-seat="${id}">${deskUse(cx, dt, d.color)}${clutter(cx, dt, hash(`${d.id}${cx}`))}` +
    `<g class="nr-off">${rect(cx - 7, dt + 1, 8, 1, '#efe2cf')}</g><g class="nr-on">${rect(cx - 7, dt + 1, 8, 1, '#3d3654')}` +
    `<rect x="${cx + 3}" y="${dt - 6}" width="1" height="5" fill="#9be8ff">${anim('opacity', '.9;.5;.9;.8;.9', 2.2)}</rect>` +
    rect(cx - 7, dt + 1, 11, 3, '#9be8ff', ' fill-opacity=".14"') +
    `<g class="nr-tag" data-cx="${cx}"${tool ? '' : ' display="none"'}>${rect(cx - Math.ceil(tw / 2) - 1, dt + 4, tw + 2, 7, OUT, ' class="nr-tag-o"')}` +
    `${rect(cx - Math.ceil(tw / 2), dt + 5, tw, 5, d.color, ' class="nr-tag-b"')}` +
    `${text(cx, dt + 9, fs, ink, tool, ' class="nr-tag-t" text-anchor="middle" font-weight="bold"')}</g></g></g>` +
    shadow(cx - 10, dt + 11, 20, 1)
  return [{ z: dt, s: chair }, { z: dt + 10, s: desk }]
}

// -- the staff in the pane, where nobody walks: most at their desks (a beanbag for whoever works lounging), one on a
// coffee break, one on the couch, and two at the foosball table, talking
function typingAt(c: Crew): Item[] {
  const fx = c.x
  const F = homeY(c.dept)
  const l = c.look
  const body = `<g>${named(c)}${shadow(fx - 4, F, 8, 1)}${figure(fx - 6, F - 20, l, 'front', [ARMS]).body}` +
    `${blink(fx - 6, F - 20, l, hash(c.id))}</g>`
  let hands = ''
  for (const [hx = 0, ph = 0] of [[fx - 5, 0], [fx + 3, 0.18]]) {
    hands += `<rect x="${hx}" y="${F - 8}" width="2" height="1" fill="${skinOf(l.skin)[0]}">${anim('y', `${F - 8};${F - 9};${F - 8}`, 0.36, ph)}</rect>`
  }
  return [{ z: F, s: body }, { z: F + 4.5, s: hands }]
}

function sideways(c: Crew, [x, F]: Pt, left: boolean): Item {
  const body = paths(frameBuf(c.look, 's0', x - 6, F - 20))
  return { z: F, s: `<g${left ? ` transform="matrix(-1 0 0 1 ${2 * x} 0)"` : ''}>${named(c)}${shadow(x - 4, F, 8, 1)}${body}</g>` }
}

// a crew member's line: small, light, two lines at most, shown from `from` to `to` seconds of every `dur`
function chatter2(cx: number, tip: number, words: string, dur: number, from: number, to: number, lo: number, hi: number): string {
  const lines = wrap(words, 22, 2)
  const w = Math.ceil(Math.max(...lines.map(l => l.length)) * 1.93) + 5
  const h = lines.length * 4.3 + 2.5
  const x = Math.max(lo, Math.min(hi - w, Math.round(cx - w / 2)))
  const y = Math.round(tip - 2 - h)
  const t = Math.max(x + 2, Math.min(x + w - 3, cx))
  let s = `<g opacity="0">${window_(dur, from, to)}` + rect(x, y, w, h, '#ffffff', ' fill-opacity=".9" rx="1.5" stroke="#5b4f72" stroke-opacity=".45" stroke-width=".4"') +
    `<path d="M${t - 1} ${y + h}h2l-1 1.5z" fill="#ffffff" fill-opacity=".9"/>`
  lines.forEach((line, i) => { s += text(x + 2.5, y + 4.4 + i * 4.3, 3.4, '#4a3f63', line) })
  return s + '</g>'
}

function paneCrew(items: Item[], over: string[], seed: number): void {
  const crew = P.crew
  const sp = P.spots
  const away = new Set<Crew>()
  const sip = crew[1]
  const couch = crew[2]
  const foos = crew.length >= 6 ? [crew[4]!, crew[5]!] : []
  for (const c of [sip, couch, ...foos]) if (c) away.add(c)
  for (const c of crew) {
    if (away.has(c)) continue
    if (c.pose === 'lounge') items.push(lounging(c.x - 8, homeY(c.dept) - 18, c, '#a78bfa'))
    else items.push(...typingAt(c))
  }
  if (sip) {
    const [jx, jF] = sp.coffee!.at
    items.push(standing(jx - 6, jF, sip, 'sip', 2))
  }
  if (couch) {
    const [cx, cF] = sp.couch1!.at
    items.push({ z: cF, s: `<g>${named(couch)}${figure(cx - 6, cF - 20, couch.look, 'back', [ARMS]).body}</g>` })
  }
  if (foos.length === 2) {
    items.push(sideways(foos[0]!, sp.foosL!.at, false), sideways(foos[1]!, sp.foosR!.at, true))
    const [a, b] = CHATTER[seed % CHATTER.length] ?? CHATTER[0]!
    const lo = P.lounge.x + 1
    const hi = P.lounge.x + P.lounge.w - 1
    over.push(chatter2(sp.foosL!.at[0], sp.foosL!.at[1] - 21, a, 12, 0.5, 4, lo, hi),
      chatter2(sp.foosR!.at[0], sp.foosR!.at[1] - 21, b, 12, 4.5, 8, lo, hi))
  }
}

// -- the kitchen: a counter with the coffee machine, the microwave and the snack jars, the fridge, the pizza table
function kitchen(items: Item[]): string {
  const r: Room = { x: 260, y: 3, w: 81, h: 85, face: 18, wall: '#6b4f9e', floor: 'nr-check' }
  let s = roomShell(r) + stringLights(r.x, r.y + 2, r.w) + sign(r.x + 3, r.y + 4, 'KITCHEN', '#8b5cf6', 0)
  s += clock(287, 5, MODE === 'pane' ? localParts(Date.now()) : undefined)       // the page draws its hands, in #nr-hands
  s += art(b => {                                                 // the chalkboard
    fill(b, 302, 4, 20, 11, '#8a5a34')
    fill(b, 303, 5, 18, 9, '#23302b')
  }) + text(312, 9.2, 3.2, '#f3efe0', 'PIZZA', ' text-anchor="middle" font-weight="bold"') +
    text(312, 13, 2.8, '#f4c542', 'FRIDAY', ' text-anchor="middle" font-weight="bold"')
  s += `<ellipse cx="300" cy="50" rx="42" ry="24" fill="url(#nr-warm)"/>`
  let counter = art(b => {
    block(b, 263, 21, 61, 4, 8, '#ece6f6', '#5b3f8c')
    for (const x of [275, 287, 299, 311]) fill(b, x, 26, 1, 6, '#4a3275')
    for (const x of [271, 283, 295, 307, 319]) fill(b, x, 28, 1, 2, '#c4b5fd')
    fill(b, 286, 12, 10, 12, '#2b2540')                           // the coffee machine
    fill(b, 287, 13, 8, 3, '#45405e')
    fill(b, 289, 18, 4, 1, '#151020')
    fill(b, 289, 20, 4, 3, '#fffdf6')
    fill(b, 300, 16, 13, 8, '#c9cdd8')                            // the microwave
    fill(b, 301, 17, 8, 6, '#1f1a2e')
    fill(b, 310, 17, 2, 6, '#a9adba')
    fill(b, 266, 17, 4, 7, '#f0e6ff')                             // the snack jars
    fill(b, 266, 20, 4, 4, '#c08a58')
    fill(b, 271, 18, 4, 6, '#f0e6ff')
    fill(b, 271, 21, 4, 3, '#ec4899')
    fill(b, 276, 19, 4, 5, '#f0e6ff')
    fill(b, 276, 21, 4, 3, '#f4c542')
  })
  counter += `<rect x="293" y="14" width="1" height="1" fill="#22c55e">${anim('opacity', '1;.2;1', 1.4)}</rect>` +
    `<rect x="310" y="18" width="1" height="1" fill="#7fe3ff">${anim('opacity', '1;.3;1', 2)}</rect>`
  for (let i = 0; i < 3; i++) {
    counter += `<rect x="${290 + i}" y="19" width="1" height="1" fill="#ffffff" opacity="0">` +
      `${anim('y', '19;11', 2, i * 0.6)}${anim('opacity', '.8;0', 2, i * 0.6)}</rect>`
  }
  items.push({ z: 33, s: counter + shadow(263, 33, 61, 1) })
  if (autumn()) items.push(...pumpkin(315, 23, SEASON === 'halloween').map(i => ({ ...i, z: 34 })))   // one on the counter
  items.push({ z: 44, s: art(b => {                                // the fridge
    block(b, 325, 10, 14, 3, 31, '#f4f1fa', '#dcd6e8')
    fill(b, 325, 24, 14, 1, '#b9b1cc')
    fill(b, 336, 16, 1, 5, '#9a93ad')
    fill(b, 336, 27, 1, 7, '#9a93ad')
    dot(b, [[328, 17], [329, 17]], '#ec4899')
    dot(b, [[330, 19]], '#14b8a6')
    fill(b, 328, 29, 3, 3, '#fffdf6')
  }) + shadow(325, 44, 14, 1) })
  items.push({ z: 62, s: shadow(299, 62, 19, 1) + art(b => {      // the table, a pizza box open on it
    fill(b, 300, 57, 1, 5, '#6b4a2e')
    fill(b, 316, 57, 1, 5, '#6b4a2e')
    block(b, 299, 50, 19, 4, 3, '#c08a58', '#9a6a3f')
    fill(b, 302, 47, 12, 5, '#e9dcc2')
    fill(b, 303, 48, 10, 3, '#f4c542')
    dot(b, [[305, 49], [309, 48], [311, 50], [307, 50]], '#d1452f')
    fill(b, 315, 48, 2, 3, '#22c55e')
  }) })
  return s
}

// -- the lounge: a game on the TV, a couch facing it, an arcade cabinet, a foosball table, a beanbag
function breakRoom(items: Item[]): string {
  const r: Room = { x: 260, y: 83, w: 81, h: 102, face: 18, wall: '#3b2763', floor: 'nr-walnut' }
  let s = roomShell(r) + pennants(r.x, r.y + 1, r.w) + sign(r.x + 3, r.y + 5, 'LOUNGE', '#ec4899', 0)
  // the doorway up to the kitchen: its floor running through, in shadow, under a wooden frame
  s += rect(327, 80, 10, 21, '#bba8d8') + rect(327, 80, 10, 21, 'url(#nr-check)') +
    rect(327, 80, 10, 21, '#140a24', ' fill-opacity=".28"') + rect(327, 83, 10, 4, '#140a24', ' fill-opacity=".35"') +
    rect(326, 83, 1, 18, '#6b4226') + rect(337, 83, 1, 18, '#6b4226') + rect(326, 83, 12, 1, '#8a5a34') +
    rect(327, 100, 10, 1, '#5e3a24')
  // the TV: a little platform game playing itself
  s += art(b => {
    fill(b, 294, 85, 26, 15, '#0e0c16')
    fill(b, 295, 86, 24, 9, '#6cc3f0')
    fill(b, 295, 95, 24, 2, '#4caf50')
    fill(b, 295, 97, 24, 2, '#8a5a34')
    fill(b, 307, 92, 5, 3, '#c98a4a')
    fill(b, 305, 100, 4, 1, '#0e0c16')
  }) + `<rect x="298" y="88" width="3" height="1" fill="#ffffff">${anim('x', '295;318;295', 9)}</rect>` +
    `<rect x="299" y="93" width="2" height="2" fill="#ef4444">${anim('y', '93;89;93;93', 1.4)}${anim('x', '297;315;297', 7)}</rect>` +
    `<rect x="309" y="89" width="1" height="1" fill="#f4c542">${anim('opacity', '1;.2;1', 0.8)}</rect>`
  s += `<ellipse cx="306" cy="128" rx="26" ry="10" fill="#5b3fa8" opacity=".5"/>` +
    `<ellipse cx="300" cy="135" rx="44" ry="30" fill="url(#nr-warm)"/>`
  // the couch, its back to us: the seat behind whoever sits in it, the back and arms in front
  items.push({ z: 120, s: art(b => {
    fill(b, 294, 120, 28, 6, '#8f74e0')
    fill(b, 303, 120, 1, 6, '#6f55c4')
    fill(b, 312, 120, 1, 6, '#6f55c4')
  }, false) })
  items.push({ z: 137, s: art(b => {
    block(b, 294, 125, 28, 3, 9, '#7c5cd6', '#5b3fa8')
    block(b, 290, 119, 5, 9, 9, '#6d4fc7', '#4c3394')
    block(b, 321, 119, 5, 9, 9, '#6d4fc7', '#4c3394')
  }) + shadow(290, 137, 36, 1) })
  // the arcade cabinet, its screen playing itself
  let arcade = art(b => {
    block(b, 262, 104, 13, 3, 22, '#2a1f4a', '#3b2a6b')
    fill(b, 263, 108, 11, 3, '#ec4899')
    fill(b, 264, 112, 9, 7, '#0e0c16')
    fill(b, 265, 113, 7, 5, '#1b2a5c')
    fill(b, 262, 120, 13, 3, '#4a3a7a')
    dot(b, [[265, 120]], '#ef4444')
    dot(b, [[269, 121], [271, 121]], '#f4c542')
    fill(b, 266, 124, 5, 3, '#2a1f4a')
    dot(b, [[268, 125]], '#f4c542')
  })
  arcade += `<rect x="266" y="114" width="2" height="1" fill="#5ef08a">${anim('x', '266;270;266', 1.6)}</rect>` +
    `<rect x="268" y="116" width="1" height="1" fill="#ffffff">${anim('y', '116;113;116', 0.8)}</rect>` +
    `<ellipse cx="268" cy="118" rx="9" ry="7" fill="url(#nr-screen)" opacity=".6"/>`
  items.push({ z: 129, s: arcade + shadow(262, 129, 13, 1) })
  // the foosball table, long side to side, its rods across
  let foos = art(b => {
    fill(b, 297, 162, 1, 6, '#4a3020')
    fill(b, 313, 162, 1, 6, '#4a3020')
    block(b, 296, 146, 19, 14, 3, '#3f8f4f', '#7a5232')
    fill(b, 296, 146, 19, 1, '#7a5232')
    fill(b, 296, 159, 19, 1, '#7a5232')
    fill(b, 296, 146, 1, 14, '#7a5232')
    fill(b, 314, 146, 1, 14, '#7a5232')
    fill(b, 303, 147, 5, 1, '#f4f4f6')
    fill(b, 303, 158, 5, 1, '#f4f4f6')
    fill(b, 297, 152, 17, 1, '#5fb06d')
    ;[149, 151, 154, 157].forEach((y, i) => {
      fill(b, 293, y, 25, 1, '#c9cdd8')
      fill(b, 291, y, 2, 1, '#2b2533')
      fill(b, 318, y, 2, 1, '#2b2533')
      for (const x of [300, 305, 310]) dot(b, [[x, y]], i % 2 ? '#3b82f6' : '#ef4444')
    })
  })
  foos += `<rect x="305" y="150" width="1" height="1" fill="#ffffff">${anim('y', '150;156;152;150', 2.2)}${anim('x', '305;302;308;305', 2.6)}</rect>`
  items.push({ z: 168, s: foos + shadow(295, 168, 21, 1) })
  const [bx, by0] = [270, 182]
  const by = by0 - DY
  if (MODE === 'page' || LITE) items.push(...bagItems(bx, by, '#ec4899'))
  else {
    const bag = beanbag(bx - 8, by - 8, '#ec4899')
    items.push({ z: by, s: bag.back + bag.front })
  }
  items.push({ z: 184, s: plant(331, 184) })
  return s
}

// -- your office: dark, LED strips shifting hue, posters, a mini-fridge, three monitors and a rainbow keyboard. You
// sit with your back to the room in a gaming chair.
function den(typing: boolean, items: Item[]): string {
  const r: Room = { x: 145, y: 3, w: 92, h: 85, face: 18, wall: '#1a1526', floor: 'nr-den' }
  let s = roomShell(r)
  const hue = (dur: number) => anim('stop-color', '#ff4fd8;#6d5bff;#2ee6d6;#ffd166;#ff4fd8', dur)
  s += `<linearGradient id="nr-rgb"><stop offset="0" stop-color="#ff4fd8">${hue(6)}</stop>` +
    `<stop offset=".5" stop-color="#6d5bff">${anim('stop-color', '#6d5bff;#2ee6d6;#ffd166;#ff4fd8;#6d5bff', 6)}</stop>` +
    `<stop offset="1" stop-color="#2ee6d6">${anim('stop-color', '#2ee6d6;#ffd166;#ff4fd8;#6d5bff;#2ee6d6', 6)}</stop></linearGradient>`
  s += rect(r.x, r.y + 2, r.w, 1, 'url(#nr-rgb)') + rect(r.x, r.y + 3, r.w, 5, 'url(#nr-rgb)', ' opacity=".18"')
  s += rect(r.x, 21, r.w, 1, 'url(#nr-rgb)', ' opacity=".9"') + rect(r.x, 22, r.w, 8, 'url(#nr-rgb)', ' opacity=".12"')
  // posters: a space invader, a ringed planet
  s += art(b => {
    fill(b, 149, 6, 12, 13, '#1f2a5c')
    stamp(b, 150, 9, ['..G....G..', '...G..G...', '..GGGGGG..', '.GG.GG.GG.', 'GGGGGGGGGG', 'G.GGGGGG.G', 'G.G....G.G'],
      { G: '#5ef08a' })
    fill(b, 223, 6, 12, 13, '#4c1d95')
    stamp(b, 224, 8, ['....pppp..', '...pPPPPp.', 'rrrPPPPPPr', '.rrrrrrrr.', '...pPPPp..', '....ppp...'],
      { p: '#f59e0b', P: '#fbbf24', r: '#f5f0e6' })
    dot(b, [[225, 16], [232, 7], [229, 17]], '#fff7c2')
  })
  // the desk against the wall, the monitors, the keyboard
  s += `<ellipse cx="191" cy="26" rx="34" ry="14" fill="url(#nr-screen)"/>`
  s += art(b => {
    block(b, 163, 22, 56, 7, 5, '#2a2638', '#1d1a29')
    fill(b, 181, 6, 20, 14, '#0e0c16')                 // the big one
    fill(b, 189, 20, 4, 3, '#0e0c16')
    fill(b, 186, 22, 10, 1, '#0e0c16')
    stamp(b, 166, 7, ['.....kkkkkkkkkk', '..kkkkkkkkkkkkk', 'kkkkkkkkkkkkkkk', 'kkkkkkkkkkkkkkk', 'kkkkkkkkkkkkkkk',
      'kkkkkkkkkkkkkkk', 'kkkkkkkkkkkkkkk', 'kkkkkkkkkkkkkkk', 'kkkkkkkkkkkkkkk', 'kkkkkkkkkkkkkkk', '..kkkkkkkkkkkkk',
      '.....kkkkkkkkkk'], { k: '#0e0c16' })
    stamp(b, 201, 7, ['kkkkkkkkkk.....', 'kkkkkkkkkkkkk..', 'kkkkkkkkkkkkkkk', 'kkkkkkkkkkkkkkk', 'kkkkkkkkkkkkkkk',
      'kkkkkkkkkkkkkkk', 'kkkkkkkkkkkkkkk', 'kkkkkkkkkkkkkkk', 'kkkkkkkkkkkkkkk', 'kkkkkkkkkkkkkkk', 'kkkkkkkkkkkkk..',
      'kkkkkkkkkk.....'], { k: '#0e0c16' })
    fill(b, 172, 19, 3, 4, '#0e0c16')
    fill(b, 207, 19, 3, 4, '#0e0c16')
    fill(b, 180, 25, 22, 3, '#14121c')                 // the keyboard
    fill(b, 205, 25, 6, 4, '#14121c')                  // the mouse pad
    fill(b, 207, 26, 2, 2, '#c9cdd8')
    fill(b, 168, 23, 2, 3, '#22c55e')                  // a can
    fill(b, 168, 23, 2, 1, '#c9cdd8')
  })
  // what's on the screens: a chart going up, a line, a table
  const scr = (inner: string) => `<g>${anim('opacity', '1;.88;1;1;.93;1', 3.3)}${inner}</g>`
  s += scr(art(b => {
    fill(b, 182, 7, 18, 12, '#152045')
    const bars = [3, 5, 4, 7, 9]
    bars.forEach((h, i) => fill(b, 184 + i * 3, 17 - h, 2, h, ['#a78bfa', '#7c3aed', '#a78bfa', '#ec4899', '#2ee6d6'][i] ?? '#a78bfa'))
    fill(b, 183, 17, 16, 1, '#3d4a7a')
    stamp(b, 167, 9, ['...LLLLLLLLLL', 'LLLLLLLLLLLLL', 'LLLLLLLLLLLLL', 'LLLLLLLLLLLLL', 'LLLLLLLLLLLLL', 'LLLLLLLLLLLLL',
      'LLLLLLLLLLLLL', '...LLLLLLLLLL'], { L: '#152045' })
    dot(b, [[169, 14], [170, 13], [171, 13], [172, 12], [173, 12], [174, 11], [175, 12], [176, 11], [177, 10], [178, 10]], '#2ee6d6')
    stamp(b, 202, 9, ['LLLLLLLLLL...', 'LLLLLLLLLLLLL', 'LLLLLLLLLLLLL', 'LLLLLLLLLLLLL', 'LLLLLLLLLLLLL', 'LLLLLLLLLLLLL',
      'LLLLLLLLLLLLL', 'LLLLLLLLLL...'], { L: '#152045' })
    for (let i = 0; i < 4; i++) fill(b, 204, 10 + i * 2, i % 2 ? 6 : 8, 1, '#c4b5fd')
    for (let i = 0; i < 4; i++) fill(b, 212, 10 + i * 2, 2, 1, i === 1 ? '#22c55e' : '#8b7fb3')
  }, false))
  // the keys, cycling the rainbow
  const keys = ['#ff5f6d', '#ffb347', '#fff275', '#7cf29c', '#5fd3ff', '#a78bfa', '#ff7ad9']
  for (let i = 0; i < 7; i++) {
    const vals = [...keys.slice(i), ...keys.slice(0, i), keys[i]].join(';')
    s += `<rect x="${181 + i * 3}" y="26" width="3" height="1" fill="${keys[i]}">${anim('fill', vals, 3.5)}</rect>`
  }
  s += rect(205, 28, 6, 1, 'url(#nr-rgb)')
  // a shelf of consoles and figures, a lamp, the mini-fridge, a rug
  s += `<ellipse cx="191" cy="56" rx="26" ry="10" fill="#2a2140"/><ellipse cx="191" cy="56" rx="26" ry="10" fill="none" stroke="url(#nr-rgb)" stroke-width="1" opacity=".55"/>`
  items.push({ z: 50, s: art(b => {
    block(b, 148, 24, 13, 3, 26, '#3a2f52', '#2a2240')
    for (let i = 0; i < 3; i++) fill(b, 149, 33 + i * 8, 11, 1, '#4b3f68')
    fill(b, 150, 29, 5, 3, '#f4f4f6')
    fill(b, 156, 30, 3, 2, '#22c55e')
    fill(b, 150, 37, 2, 3, '#ef4444')
    fill(b, 153, 36, 2, 4, '#3b82f6')
    fill(b, 156, 37, 3, 3, '#f4c542')
    fill(b, 150, 45, 9, 3, '#14121c')
    dot(b, [[151, 46], [157, 46]], '#7fe3ff')
  }) })
  items.push({ z: 62, s: art(b => {
    block(b, 222, 45, 13, 3, 16, '#24212f', '#1a1824')
    fill(b, 224, 49, 9, 10, '#173a5c')
    for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) fill(b, 225 + j * 3, 51 + i * 4, 2, 3, ['#ef4444', '#22c55e', '#f4c542'][(i + j) % 3] ?? '#ef4444')
    fill(b, 232, 50, 1, 6, '#c9cdd8')
  }) + `<rect x="223" y="58" width="1" height="1" fill="#7fe3ff">${anim('opacity', '1;.2;1', 1.3)}</rect>` +
    `<ellipse cx="228" cy="54" rx="8" ry="7" fill="url(#nr-cyan)"/>` })
  items.push({ z: 64, s: art(b => {
    fill(b, 166, 40, 2, 22, '#2a2638')
    fill(b, 164, 62, 6, 2, '#2a2638')
  }) + rect(166, 41, 2, 20, 'url(#nr-rgb)') + `<ellipse cx="167" cy="51" rx="8" ry="11" fill="url(#nr-screen)" opacity=".7"/>` })
  const bag = beanbag(149, 62, '#3b2f5c')
  items.push({ z: 71, s: bag.back + bag.front + art(b => {
    stamp(b, 154, 63, ['.CCCCC.', 'CwCCCbC', 'CCCCCCC', '.C...C.'], { C: '#e5e7eb', w: '#3a3352', b: '#ef4444' })
  }) })
  // you, and your chair in front of you
  const x = 185
  const y = 23
  const f = figure(x, y, P.cfg.owner.look, 'back', [], [ARMS, ARMS_UP])
  const dur = 41                                     // every so often, a stretch
  let me = shadow(184, 49, 14, 2) + `<g id="nr-owner-back">${f.body}<g>${steps(dur, [[0, 1], [dur - 2.4, 0]])}${f.parts[0]}</g>` +
    `<g opacity="0">${steps(dur, [[0, 0], [dur - 2.4, 1]])}${f.parts[1]}</g></g><g id="nr-owner-turn"></g>`
  if (typing || MODE === 'page') {
    me += `<g class="nr-typing">${anim('transform', '0 0;0 -1;0 0', 0.5, 0, ' type="translate" attributeType="XML"').replace('<animate ', '<animateTransform ')}` +
      art(b => dot(b, [[x + 1, y + 13], [x + 10, y + 13]], '#d7b49a'), false) + '</g>'
  }
  me += art(b => {
    stamp(b, x + 1, y + 16, ['.kKKKKKKk.', 'kKPKKKKPKk', 'kKPKKKKPKk', 'kKPKKKKPKk', '.kKKKKKKk.', '...kkkk...',
      '....kk....', '....kk....', '.kkkkkkkk.'],
    { K: '#2a2636', k: '#1b1824', P: '#8b5cf6' })
    dot(b, [[x + 2, y + 25], [x + 9, y + 25], [x + 5, y + 25]], '#3a3352')
  })
  items.push({ z: 54, s: `<g><title>${esc(P.cfg.owner.name)}</title>${me}</g>` })
  if (autumn()) items.push(...pumpkin(172, 84, SEASON === 'halloween', true))
  return s
}

// -- the lobby: the neon sign, the TV, the front desk by the entrance where Claude sits, a coffee cart, a trophy,
// the sitting corner
function lobby(o: { claudeHere: boolean; typing: boolean; inbox: number; onBreak: boolean }, items: Item[],
  over: string[]): string {
  const r: Room = { x: 145, y: 83, w: 92, h: 102, face: 18, wall: '#2e1065', floor: 'nr-lobby' }
  let s = roomShell(r)
  // the team photo, framed: everyone in a row under a banner
  s += art(b => {
    fill(b, 148, 87, 15, 12, '#c99a62')
    fill(b, 149, 88, 13, 10, '#9fd3f5')
    fill(b, 149, 94, 13, 4, '#5bb46a')
    fill(b, 150, 88, 11, 2, '#7c3aed')
    const heads = ['#4a2e1c', '#e8c872', '#2a1c14', '#8f3f1e', '#4fd1c5', '#1d140f']
    heads.forEach((c, i) => {
      dot(b, [[150 + i * 2, 92]], c)
      dot(b, [[150 + i * 2, 93]], '#f7d7bd')
      dot(b, [[150 + i * 2, 94]], ['#2f4a7a', '#d99aa3', '#2f6f6a', '#b9a6f0', '#3a3a46', '#c8643b'][i]!)
    })
  })
  // the neon sign
  const flick = anim('opacity', '1;1;.55;1;1', 7, 0, ' keyTimes="0;.9;.92;.94;1"')
  s += `<g filter="url(#nr-blur)" opacity=".9">${text(190, 90.6, 4.6, '#a78bfa', 'AGENT OFFICE', ' text-anchor="middle" font-weight="bold"')}` +
    `${text(190, 96.6, 3.6, '#a78bfa', 'WELCOME', ' text-anchor="middle" font-weight="bold" letter-spacing=".8"')}</g>`
  s += `<g>${flick}${text(190, 90.6, 4.6, '#f3efff', 'AGENT OFFICE', ' text-anchor="middle" font-weight="bold"')}` +
    `${text(190, 96.6, 3.6, '#c4b5fd', 'WELCOME', ' text-anchor="middle" font-weight="bold" letter-spacing=".8"')}</g>`
  // the TV: a screensaver, a square drifting corner to corner
  s += art(b => {
    fill(b, 212, 85, 22, 13, '#0e0c16')
    fill(b, 213, 86, 20, 11, '#1f1a2e')
    fill(b, 221, 98, 4, 1, '#0e0c16')
  }) + `<rect x="214" y="87" width="3" height="3" fill="#a78bfa">${anim('x', '214;229;222;214', 7)}${anim('y', '87;93;87;93;87', 5)}</rect>` +
    `<rect x="213" y="86" width="20" height="1" fill="#ffffff" fill-opacity=".08">${anim('y', '86;96;86', 3)}</rect>`
  // a doormat at the entrance
  s += art(b => fill(b, 177, 179, 21, 6, '#7c3aed'), false) + rect(178, 180, 19, 4, '#6d28d9')
  s += `<ellipse cx="187" cy="150" rx="40" ry="9" fill="#5b3fa8" opacity=".35"/>`
  s += `<ellipse cx="187" cy="128" rx="34" ry="14" fill="url(#nr-warm)"/>`
  // the front desk, Claude behind it
  const desk = art(b => {
    block(b, 163, 122, 47, 4, 10, '#c4b5fd', '#2e1065')
    fill(b, 163, 131, 47, 1, '#7c3aed')
    b.delete(at(163, 122))
    b.delete(at(209, 122))
    fill(b, 166, 119, 12, 4, '#4b4560')               // the inbox tray
    if (MODE === 'pane') for (let i = 0; i < Math.min(o.inbox, 4); i++) fill(b, 167, 121 - i, 10, 1, i % 2 ? '#e9e4d8' : '#fffdf6')
    stamp(b, 203, 118, ['.gg.', 'gGgg', 'gggg', 'kkkk'], { g: '#e2b65e', G: '#fff2c4', k: '#8a6a2a' })   // the bell
  }) + text(186.5, 129.4, 3.6, '#c4b5fd', 'FRONT DESK', ' text-anchor="middle" font-weight="bold"') +
    art(b => fill(b, 164, 112, 16, 6, '#ffffff')) + text(172, 116.3, 3.5, '#2e1065', `INBOX ${o.inbox}`, ' id="nr-inbox" text-anchor="middle" font-weight="bold"') +
    (MODE === 'page' ? [0, 1, 2, 3].map(i => rect(167, 121 - i, 10, 1, i % 2 ? '#e9e4d8' : '#fffdf6',
      ` class="nr-pile"${i < o.inbox ? '' : ' display="none"'}`)).join('') : '')
  let front = ''
  if (o.claudeHere) {
    const cx = 188
    const f = figure(cx - 6, 108, CLAUDE, 'front', [ARMS])
    front += `<g><title>Claude, at the front desk</title>${f.body}${blink(cx - 6, 108, CLAUDE, 3)}</g>`
    if (o.typing || MODE === 'page') {
      let hands = ''
      for (const [hx, ph] of [[cx - 5, 0], [cx + 3, 0.18]]) {
        hands += `<rect x="${hx}" y="122" width="2" height="1" fill="${skinOf(CLAUDE.skin)[0]}">${anim('y', '122;121;122', 0.36, ph)}</rect>`
      }
      front += g(hands, ' class="nr-typing"')
    }
    front = g(front, ' id="nr-claude"')               // the page hides it while Claude chairs a meeting, or is closed
  }
  let sign2 = ''
  if (!o.claudeHere) {
    sign2 = art(b => {
      fill(b, 181, 113, 22, 7, '#ffffff')
      fill(b, 185, 120, 1, 2, '#9a93ad')
      fill(b, 198, 120, 1, 2, '#9a93ad')
    }) + text(192, 117.9, 3.5, '#2e1065', 'BACK SOON', ' text-anchor="middle" font-weight="bold"')
  }
  items.push({ z: 136, s: front + desk + (o.claudeHere ? '' : sign2) + shadow(163, 137, 47, 2) })
  // the coffee cart, its machine steaming
  let cart = art(b => {
    block(b, 217, 113, 18, 4, 9, '#efeaf6', '#7c5a3a')
    fill(b, 219, 104, 9, 10, '#4a4560')
    fill(b, 220, 105, 7, 2, '#6a6385')
    fill(b, 222, 108, 3, 1, '#2b2540')
    fill(b, 222, 111, 3, 2, '#fffdf6')
    fill(b, 230, 110, 3, 4, '#fffdf6')
    fill(b, 230, 108, 3, 2, '#e9e4d8')
  })
  cart += `<rect x="226" y="106" width="1" height="1" fill="#ef4444">${anim('opacity', '1;.2;1', 1)}</rect>`
  for (let i = 0; i < 3; i++) {
    cart += `<rect x="${222 + i}" y="110" width="1" height="1" fill="#ffffff" opacity="0">` +
      `${anim('y', '110;103', 2, i * 0.6)}${anim('opacity', '.8;0', 2, i * 0.6)}</rect>`
  }
  items.push({ z: 126, s: cart + shadow(217, 127, 18, 1) })
  // the trophy on its plinth, catching the light
  items.push({ z: 150, s: art(b => {
    block(b, 214, 140, 14, 3, 7, '#4c2a85', '#2e1065')
    fill(b, 219, 145, 8, 1, '#c4b5fd')
  }) + `<g id="nr-trophy">${art(b => stamp(b, 216, 126, ['.GGGGGGGG.', 'GgGGGGGGgG', 'G.GGWGGG.G', 'G.GGGGGG.G', '.GGGGGGGG.',
    '..GGGGGG..', '...GGGG...', '....GG....', '....GG....', '...gGGg...', '..GGGGGG..', '..gggggg..'],
  { G: '#f4c542', g: '#c9962a', W: '#fff7d1' }))}</g>` +
    `<rect x="220" y="128" width="1" height="2" fill="#ffffff">${anim('opacity', '0;1;0', 2.6)}</rect>` +
    `<ellipse cx="221" cy="133" rx="9" ry="8" fill="url(#nr-warm)"/>` + shadow(214, 150, 14, 1) })
  // the lounge: a rug, the beanbag, a plant; Claude here on a break
  s += `<ellipse cx="210" cy="172" rx="18" ry="7" fill="#5b3fa8" opacity=".55"/>`
  const bag = beanbag(201, 166, '#7c3aed')
  let lounge = shadow(201, 175, 17, 1) + bag.back
  if (o.onBreak) {
    const f = figure(203, 153, CLAUDE, 'front', [ARM_L], [SIP_DOWN, SIP_UP])
    lounge += `<g><title>Claude, on a break</title>${f.body}${blink(203, 153, CLAUDE, 4)}` +
      `<g>${steps(6, [[0, 1], [4.4, 0]])}${f.parts[0]}</g><g opacity="0">${steps(6, [[0, 0], [4.4, 1]])}${f.parts[1]}</g></g>`
    for (let i = 0; i < 2; i++) {
      lounge += `<rect x="${214 + i}" y="166" width="1" height="1" fill="#ffffff" opacity="0">` +
        `${anim('y', '166;161', 1.8, i * 0.9)}${anim('opacity', '.8;0', 1.8, i * 0.9)}</rect>`
    }
    over.push(speech(211, 154, 'On break', 146, 236))
  }
  lounge += bag.front
  items.push({ z: 176, s: lounge })
  items.push({ z: 184, s: plant(147, 184, true) })
  if (autumn()) {                                                 // pumpkins either side of the doormat
    items.push(...pumpkin(168, 184, SEASON === 'halloween'), ...pumpkin(199, 184, SEASON === 'halloween', true))
  }
  if (SEASON === 'holiday') {                                     // the tree by the front desk, lights along the wall
    items.push(holidayTree(151, 132))
    s += stringLights(r.x, r.y + 2, r.w)
  }
  items.push({ z: 166, s: art(b => {
    block(b, 152, 150, 24, 5, 3, '#8b7bc8', '#6f5fae')            // the back
    block(b, 152, 157, 24, 4, 5, '#a596dc', '#7d6cbd')            // the seat
    block(b, 149, 152, 4, 9, 9, '#8b7bc8', '#6f5fae')             // the arms
    block(b, 175, 152, 4, 9, 9, '#8b7bc8', '#6f5fae')
    fill(b, 158, 153, 6, 4, '#f4c542')                             // a cushion
    fill(b, 158, 153, 6, 1, '#f9dc85')
  }) + shadow(149, 167, 30, 1) + art(b => {                         // a low table with a magazine and a mug
    block(b, 160, 171, 16, 3, 3, '#c08a58', '#9a6a3f')
    fill(b, 162, 171, 6, 2, '#ec4899')
    fill(b, 171, 170, 2, 2, '#fffdf6')
  }) })
  return s
}

// -- the conference room (the browser window's alone; the pane ends at its wall): a long walnut table down the
// middle, four chairs a side, Claude's at its head under the wall screen, yours at its foot, and the whiteboard beside
// the screen. The screen shows the agenda and the proposal being presented, or "Call a meeting" when none is on
// (conference.js draws it, from meeting.js); the whiteboard shows the project's branches (extras.js, from the live
// list). Dim and empty with no meeting on: the page lifts the dark when one is (data-meet).
export function confGeom() {
  const X = P.conf.x
  return { screen: [X + 3, 6, 44, 20] as const, call: [X + 6, 20, X + 44, 25] as const, board: [X + 50, 5, BOARD[0], BOARD[1]] as const }
}
function conferenceRoom(items: Item[]): string {
  const c = P.conf
  const X = c.x
  const r: Room = { x: X, y: c.y, w: c.w, h: c.h, face: c.face, wall: '#463a5e', floor: 'nr-board' }
  const { screen: [sx, sy, sw, sh], board: [bx, by, bw, bh] } = confGeom()
  const mid = X + CONF.mid
  const [t0, t1] = [X + CONF.table[0], X + CONF.table[1]]
  let s = roomShell(r)
  // the wall: the screen in its bezel (conference.js writes on it), the whiteboard in its frame (extras.js)
  s += art(b => {
    fill(b, sx - 1, sy - 1, sw + 2, sh + 2, '#0e0c16')
    fill(b, sx, sy, sw, sh, '#121a36')
    fill(b, sx + sw / 2 - 3, sy + sh + 1, 6, 1, '#0e0c16')
  }) + `<g id="nr-p-conf" transform="translate(${sx} ${sy})"><clipPath id="nr-clip-conf"><rect width="${sw}" height="${sh}"/></clipPath></g>`
  const board = art(b => {
    fill(b, bx - 1, by - 1, bw + 2, bh + 2, '#a9adba')
    fill(b, bx, by, bw, bh, '#f7f5f0')
    fill(b, bx + 4, by + bh + 1, bw - 8, 1, '#8a8f9e')                // the marker tray
    dot(b, [[bx + 8, by + bh], [bx + 10, by + bh]], '#dc2626')
    dot(b, [[bx + 13, by + bh], [bx + 15, by + bh]], '#2563eb')
  }) + `<g id="nr-p-wb" transform="translate(${bx} ${by})"><clipPath id="nr-clip-wb"><rect width="${bw}" height="${bh}"/></clipPath></g>`
  // the rug under the table, and the light when a meeting is on: the screen's glow, warm pools down the table
  s += art(b => {
    fill(b, t0 - 12, 44, t1 - t0 + 24, 140, '#323659')
    fill(b, t0 - 11, 45, t1 - t0 + 22, 138, '#3a3f66')
    fill(b, t0 - 9, 47, t1 - t0 + 18, 134, '#323659')
  }, false)
  LIGHTS.push(g(`<ellipse cx="${sx + sw / 2}" cy="${sy + sh + 9}" rx="26" ry="7" fill="url(#nr-screen)" opacity=".8"/>` +
    [76, 110, 144, 176].map(y => `<ellipse cx="${mid}" cy="${y}" rx="26" ry="16" fill="url(#nr-warm)"/>`).join(''), ' class="conf-lit"'))
  // the chairs: off each side, their backs away from the table; the head's high back behind Claude; the foot's in
  // front of you (you sit with your back to us, facing the screen)
  const sideChair = (x: number, y: number, west: boolean) => art(b => {
    const back = west ? x - 8 : x + 6
    fill(b, back, y - 15, 3, 12, '#2b2540')
    fill(b, back, y - 15, 3, 1, '#4a4560')
    fill(b, west ? x - 6 : x - 4, y - 7, 11, 4, '#3d3654')
    fill(b, west ? x - 6 : x - 4, y - 7, 11, 1, '#5a5274')
    fill(b, west ? x - 2 : x + 2, y - 3, 1, 2, '#1d1828')
  })
  for (const y of CONF.rows) {
    items.push({ z: y - 1, s: sideChair(X + CONF.sitW, y, true) + shadow(X + CONF.sitW - 7, y - 1, 13, 1) })
    items.push({ z: y - 1, s: sideChair(X + CONF.sitE, y, false) + shadow(X + CONF.sitE - 5, y - 1, 13, 1) })
  }
  items.push({ z: 49, s: art(b => {
    fill(b, mid - 7, 33, 14, 10, '#2b2540')
    fill(b, mid - 6, 34, 12, 1, '#4a4560')
    b.delete(at(mid - 7, 33))
    b.delete(at(mid + 6, 33))
  }) })
  items.push({ z: 187, s: art(b => stamp(b, mid - 5, 181, ['.kKKKKKKKk.', 'kKPKKKKKPKk', '.kKKKKKKKk.', '....kkk....', '...kkkkk...'],
    { K: '#3d3654', k: '#2b2540', P: '#5a5274' })) })
  // the table: walnut, a lighter runner down it; a notepad or a laptop at each side chair, a speakerphone, the agenda
  items.push({ z: 168, s: shadow(t0 - 1, 168, t1 - t0 + 2, 1) + art(b => {
    block(b, t0, 54, t1 - t0, 110, 4, '#a0714d', '#5e3a24')
    fill(b, mid - 2, 58, 4, 102, '#b5845d')
    CONF.rows.forEach((y, i) => {
      const pad = (x: number) => fill(b, x, y - 15, 4, 3, '#fffdf6')
      const laptop = (x: number) => {
        fill(b, x, y - 16, 4, 4, '#c9cdd8')
        fill(b, x, y - 13, 4, 1, '#a9adba')
      }
      if (i % 2) { pad(t0 + 1); laptop(t1 - 5) } else { laptop(t0 + 1); pad(t1 - 5) }
      dot(b, [[i % 2 ? t0 + 4 : t1 - 2, y - 9]], '#9fd8ff')
    })
    stamp(b, mid - 3, 100, ['.kkkkk.', 'kkKKKkk', 'kKKgKKk', '.kkkkk.'], { k: '#2b2533', K: '#3a3352', g: '#5ef08a' })
    fill(b, mid - 5, 60, 10, 3, '#fffdf6')
    fill(b, mid - 4, 61, 6, 1, '#c9c2d6')
  }) })
  items.push({ z: 46, s: plant(X + c.w - 12, 46, true) })
  if (autumn()) items.push(...pumpkin(X + 3, 190, SEASON === 'halloween'))
  // the door from the lounge, open against the wall
  s += rect(X - 3, 155, 3, 16, '#3c4166') + art(b => {
    fill(b, X, 155, 2, 16, '#8a5a34')
    fill(b, X, 155, 2, 1, '#a8704a')
    dot(b, [[X + 1, 163]], '#e2b65e')
  }, false)
  // dim without a meeting (the whiteboard stays lit: it is drawn over the dimness)
  TOP.push(g(rect(X, c.y - 2, c.w, c.h + 2, '#05020d', ' fill-opacity=".5" pointer-events="none"'), ' class="conf-dim"'), board)
  return s
}

// -- time: the machine's own clock. The pane's sky and kitchen clock follow it; the page keeps its own from the browser.
function localParts(now: number): { hour: number; minute: number } {
  const d = new Date(now)
  return { hour: d.getHours(), minute: d.getMinutes() }
}
const skyOf = (t: { hour: number }) => (t.hour < 6 || t.hour >= 19 ? 'night' : t.hour >= 17 ? 'dusk' : 'day')

export const HANDBACK_MS = 12_000 // a finished agent's desk is visited this long after it hands back (the pane)

// The drawing. For the pane, at most 131072 characters (the Svg element's limit): with a crowd of agents, the staff
// and pets step out rather than the picture going missing. For the page, the office without anyone who walks: the
// page's engine adds them, into a stage of furniture it keeps sorted by depth.
let LITE = false
let MODE: 'pane' | 'page' = 'pane'
export function office(list: Staffer[], now: number, mode: 'pane' | 'page' = 'pane'): string {
  MODE = mode
  LITE = false
  const full = scene(list, now)
  if (mode === 'page' || full.length <= 130_000) return full
  LITE = true
  return scene(list, now)
}

function scene(list: Staffer[], now: number): string {
  const t = localParts(now)
  const sky = skyOf(t)
  const page = MODE === 'page'
  const OX = P.OX
  const AW = page ? P.AW : P.PW
  const working = list.filter(x => !x.isDone)
  const recent = page ? undefined : list.filter(x => x.isDone && x.endedAt && now - x.endedAt < HANDBACK_MS).slice(-1)[0]
  const items: Item[] = []
  const over: string[] = []
  SHARED.clear()
  SEASON = P.cfg.seasons ? seasonOf(now) : ''
  NIGHT = sky === 'night'
  LIGHTS = []
  TOP = []
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${AW * 2} ${AH * 2}" width="${AW * 2}" height="${AH * 2}" ` +
    `shape-rendering="crispEdges"><defs>${patterns()}${glows()}</defs><g transform="scale(2)">` + rect(0, 0, AW, AH, '#2a1a40')

  // the departments
  let visit: { cx: number; dt: number } | undefined
  for (const d of P.depts) {
    const here = working.filter(x => deptOf(x.desk) === d)
    const handed = list.filter(x => x.isDone && deptOf(x.desk) === d).length
    s += deptRoom(d, here, handed, sky, over, items)
    if (recent && deptOf(recent.desk) === d) {
      const i = Math.min(d.seats - 1, here.length)
      visit = { cx: seatX(d, i), dt: deskTop(d) }
    }
  }
  if (page) s += `<g id="nr-hands">${art(b => clockHands(b, 287 + OX, 5, t), false)}</g>`   // redrawn by the page
  // the doorways between rooms, the entrance, and the shade over your office's door
  for (const d of P.doors) s += rect(d.x, d.y, 3, d.h, d.color)
  s += rect(176 + SHIFT + OX, AH - 3, 22, 3, '#6d28d9') + rect(162 + OX, 62, 3, 1, '#140a24')
  // your office, the lobby, the kitchen and the lounge, drawn where they always were and moved over (and down)
  const onBreak = !visit && working.length === 0 && !page
  const n = list.filter(x => x.isDone).length
  const placed = (draw: () => string, dx: number, dy: number) => {
    const i0 = items.length
    const o0 = over.length
    const out = g(draw(), ` transform="translate(${dx} ${dy})"`)
    for (let i = i0; i < items.length; i++) items[i] = { z: items[i]!.z + dy, s: g(items[i]!.s, ` transform="translate(${dx} ${dy})"`) }
    for (let i = o0; i < over.length; i++) over[i] = g(over[i]!, ` transform="translate(${dx} ${dy})"`)
    return out
  }
  s += placed(() => den(working.length > 0, items), SHIFT + OX, 0)
  s += placed(() => lobby({ claudeHere: !visit && !onBreak, typing: working.length > 0, inbox: n, onBreak }, items, over),
    SHIFT + OX, DY)
  s += placed(() => kitchen(items), OX, 0) + placed(() => breakRoom(items), OX, DY)
  if (page) s += conferenceRoom(items)
  if (P.pets.length) {
    items.push(catBed(236 + OX, 80, '#5b3fa8', '#8f74e0'), catBed(247 + OX, 189, '#c97b86', '#f4c3cb'),
      catBowl(264 + OX, 75))
    if (P.pets.length > 1) items.push(catBowl(285 + OX, 75))
  }
  if (!LITE) catStatics(items, page)
  if (!page && !LITE) paneCrew(items, over, Math.floor(now / 60_000))
  if (page) {                                                   // the staff at their desks, until the engine starts
    for (const c of P.crew) {
      const F = homeY(c.dept)
      items.push({ z: F, s: `<use class="nr-static" href="#sp-${c.id}-f0" x="${c.x - 6}" y="${F - 20}"/>` })
    }
  }

  // Claude, called over to a desk that just handed back: walks up, says so, and the report flies to the inbox
  if (visit) {
    const ago = recent!.endedAt ? (now - recent!.endedAt) / 1000 : 9
    const x = visit.cx - 8
    const feet = visit.dt + 16
    const f = figure(x, feet - 20, CLAUDE, 'front', [ARMS])
    const b = figure(x, feet - 20, CLAUDE, 'back', [ARMS])
    const walk = 1.2
    let c = ''
    if (ago < walk) {
      c += `<g><animateTransform attributeName="transform" type="translate" values="0 14;0 0" dur="${walk}s" begin="${-ago}s" fill="freeze"/>` +
        `<g>${b.body}<set attributeName="opacity" to="0" begin="${(walk - ago).toFixed(2)}s"/></g>` +
        `<g opacity="0">${f.body}<set attributeName="opacity" to="1" begin="${(walk - ago).toFixed(2)}s"/></g></g>`
    } else c += f.body + blink(x, feet - 20, CLAUDE, 2)
    items.push({ z: feet, s: `<g><title>Claude</title>${shadow(x + 2, feet, 8, 1)}${c}</g>` })
    over.push(speech(visit.cx - 2, feet - 20, 'Nice work', visit.cx - 30, visit.cx + 30))
    const fly = 1.4
    if (ago < fly) {
      const dx = 171 + SHIFT + OX - (visit.cx - 5)
      const dy = 120 + DY - visit.dt
      over.push(`<g>${art(bb => {
        fill(bb, visit!.cx - 7, visit!.dt - 1, 6, 4, '#fffdf6')
        fill(bb, visit!.cx - 6, visit!.dt, 4, 1, '#c9c2d6')
      })}<animateMotion path="M0 0Q${Math.round(dx / 2)} ${Math.round(Math.min(dy, 0) - 30)} ${dx} ${dy}" dur="${fly}s" begin="${-ago}s" fill="freeze"/>` +
        `<set attributeName="opacity" to="0" begin="${(fly - ago).toFixed(2)}s"/></g>`)
    }
  }

  items.sort((a, b) => a.z - b.z)
  if (page) s += `<g id="nr-stage">${items.map(i => `<g data-z="${i.z}">${i.s}</g>`).join('')}</g>`
  else s += items.map(i => i.s).join('')
  let defs = [...SHARED.values()].join('')
  if (page) {                                                   // everyone's frames, for the engine
    for (const c of P.crew) defs += spriteDefs(c.id, c.look, ALL_FRAMES)
    for (const d of P.depts) defs += spriteDefs(`g-${d.id}`, agentLook(`generic-${d.id}`, d.color), WALK_FRAMES)
    defs += spriteDefs('owner', P.cfg.owner.look, WALK_FRAMES) + spriteDefs('claude', CLAUDE, WALK_FRAMES)
    for (const p of P.pets) defs += catDefs(`p${p.i}`, petLook(p), p.i)
  }
  s = s.replace('</defs>', defs + '</defs>')
  s += TOP.join('')
  if (page) {
    s += rect(0, 0, AW, AH, '#0a0b30', ' class="sky-night" fill-opacity=".42" pointer-events="none"') +
      `<g id="nr-lights" pointer-events="none">${LIGHTS.join('')}</g>` +
      rect(0, 0, AW, AH, 'url(#nr-vignette)', ' pointer-events="none"') +
      `<g id="nr-over">${over.filter(o => o.includes('nr-static')).join('')}</g>`
  } else {
    if (sky === 'night') s += rect(0, 0, AW, AH, '#0a0b30', ' fill-opacity=".42"') + LIGHTS.join('')
    s += over.join('')
  }
  return s + '</g></svg>'
}

// -- the page: the office, the lists under it, and the engine with the floor plan it walks
export function layoutCfg(key: string): unknown {
  const OX = P.OX
  const rooms = [...P.depts.map(d => ({ id: d.id, x: d.x, y: d.y, w: d.w, h: d.h })), { id: 'den', ...P.den },
    { id: 'lobby', ...P.lobby }, { id: 'kitchen', ...P.kitchen }, { id: 'lounge', ...P.lounge }, { id: 'conf', ...P.conf }]
  const v = P.visitor
  const cg = confGeom()
  return {
    key, nodes: P.nodes, edges: P.edges, rooms, aw: P.AW,
    seats: Object.fromEntries(P.depts.map(d => [d.id, [...Array(d.seats)].map((_, i) => ({ id: `${d.id}-${i}`,
      node: `${d.id}-s${i}`, hz: deskTop(d) + 10.5 }))])),
    overflow: P.overflow,
    desks: Object.fromEntries(P.depts.map(d => [d.id, { color: d.color, label: d.name }])),
    crew: P.crew.map(c => ({ name: c.id, skin: skinOf(c.look.skin)[0], home: `home-${c.id}`, pose: c.pose,
      hz: homeY(c.dept) + 4.5 })),
    spots: Object.fromEntries(Object.entries(P.spots).map(([id, sp]) => [id, { node: `spot-${id}`, pose: sp.pose,
      dir: sp.dir, pairs: sp.pairs ?? [], weight: sp.weight }])),
    lobby: { out: 'out', handoff: ['lobby-h0', 'lobby-h1'], tray: [167 + SHIFT + OX, 118 + DY], claude: [188 + SHIFT + OX, 107 + DY] },
    owner: { name: P.cfg.owner.name, at: [191 + SHIFT + OX, 43], turnAt: [185, 23], monitor: [191 + SHIFT + OX, 8],
      desk: [214 + SHIFT + OX, 25] },
    cats: {
      nodes: P.cat.nodes, edges: P.cat.edges, jumps: P.cat.jumps, spots: P.cat.spots, start: P.cat.start,
      list: P.pets.map(p => {
        const c = petLook(p)
        return { i: p.i, id: `p${p.i}`, name: p.name, speed: c.speed, size: Object.fromEntries(CAT_KEYS.map(k => [k, catSize(c, k)])),
          eyes: catEyes(c) }
      }),
    },
    visit: v ? { who: v.id, spots: { side: 'den-owner', perch: 'den-perch' } } : null,
    clock: [293 + OX, 11],
    chatter: CHATTER,
    soundtrack: P.cfg.soundtrack.enabled,                       // the lo-fi toggle shown (playback always starts off)
    door: [207 + OX, 158],                                       // where the CLOSED sign stands, in front of the entrance
    conf: { seats: P.confSeats, from: P.confFrom, screen: cg.screen, call: cg.call },
    board: { at: cg.board },
    // the easter eggs (README's "Spoilers"): the codes the front desk keeps for itself, and where things are
    eggs: {
      codes: EGG_CODES,
      press: { trophy: [234 + OX, 133, 249 + OX, 156], coffee: [285 + OX, 11, 297 + OX, 25] },
      coffee: { spout: [290 + OX, 20], counter: 33 },
      arcade: { screen: [265 + OX, 121, 7, 5], marquee: [263 + OX, 116, 11, 3] },
      trophyX: 221,
    },
  }
}

// The page's style sheet, a file of its own (the page's CSP allows no inline style): the office as the hero on the
// left, the lists of who is on the floor under it, and the front desk's conversation down the right side. Under
// 1100 px wide it stacks: the office, the chat, the lists.
export function pageCss(): string {
  const dots = P.depts.map(d => `.dot.${d.id}{background:${d.color}}`).join('')
  return `:root{--bg:#120b1f;--panel:#1b1330;--panel2:#231a3c;--line:#3a2a5c;--ink:#efeaff;--dim:#b1a6cf;--faint:#9a90bf;
--violet:#a78bfa;--claude:#e08a68;--owner:#b8a4ec;--px:2px;color-scheme:dark}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:radial-gradient(1200px 700px at 30% 20%,#221640 0,#120b1f 70%) fixed,#120b1f;color:var(--ink);
font:15px/1.55 "Segoe UI",system-ui,-apple-system,sans-serif;overflow:hidden}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.px{display:block;height:calc(var(--px) * 7);fill:currentColor}
.app{display:grid;grid-template-columns:minmax(0,1fr) clamp(340px,27vw,520px);gap:18px;height:100vh;padding:16px 18px}
.floor{display:flex;flex-direction:column;min-width:0;min-height:0;gap:12px}
.bar{display:flex;align-items:center;gap:14px;min-height:22px;color:#d9ccff}
.bar h1{margin:0;--px:2px}
.stage{display:flex;justify-content:center;flex:0 0 auto}
.frame{position:relative;padding:5px;background:#0d0818;box-shadow:0 0 0 3px #4a3670,0 0 0 6px #0d0818,0 18px 40px #0008;
width:min(100%,calc((100vh - 330px) * ${P.AW} / ${AH} + 10px))}
#nr{display:block;width:100%;height:auto;image-rendering:pixelated}
.board{flex:1 1 auto;min-height:120px;display:grid;grid-template-columns:1fr 1fr;gap:18px;overflow:hidden}
.col{display:flex;flex-direction:column;min-height:0;background:var(--panel);box-shadow:0 0 0 2px var(--line);padding:8px 10px}
.col h2{display:flex;align-items:center;gap:8px;margin:0 0 6px;color:#d9ccff;--px:2px}
.col h2 .n{font:600 12px/1 ui-monospace,Consolas,monospace;color:var(--faint)}
.col ul{list-style:none;margin:0;padding:0;overflow:auto;min-height:0}
.row{display:grid;grid-template-columns:10px 92px minmax(0,1fr) auto 34px;align-items:center;gap:8px;width:100%;
height:28px;padding:0 6px;border:0;background:none;color:var(--ink);font:inherit;font-size:14px;text-align:left;border-radius:2px}
button.row{cursor:pointer}button.row:hover,button.row.picked{background:var(--panel2)}
button.row:focus-visible{outline:2px solid var(--violet);outline-offset:-2px}
.row .dot{width:8px;height:8px;display:block;background:#fff}${dots}
.row b{font:700 11px/1 ui-monospace,Consolas,monospace;letter-spacing:.04em;color:var(--dim);white-space:nowrap;overflow:hidden;
text-overflow:ellipsis;text-transform:uppercase}
.row .task{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row em{font:600 11px/1 ui-monospace,Consolas,monospace;font-style:normal;color:#9fe3ff;background:#1c2b44;padding:3px 5px}
.row em:empty{visibility:hidden}.row.done{grid-template-columns:10px 92px minmax(0,1fr) 34px}
.row.done em{display:none}.row small{color:var(--faint);text-align:right;font-variant-numeric:tabular-nums}
.row.done{color:var(--dim)}.row.failed .task{color:#ff9b9b}
.col li.empty{color:var(--faint);font-size:14px;padding:6px}
.desk{display:flex;flex-direction:column;min-height:0;container-type:inline-size;background:var(--panel);
box-shadow:0 0 0 3px #4a3670,0 0 0 6px #0d0818,0 18px 40px #0008;position:relative}
.fd-head{display:flex;align-items:center;gap:12px;padding:12px 14px;background:linear-gradient(#2b1f4a,#221838);
border-bottom:2px solid #0d0818}
.fd-head .av{width:36px;height:36px;background:#3a2a5c;box-shadow:0 0 0 2px #0d0818}
.fd-head h2{margin:0;color:#f3edff;--px:2px}
.fd-id{flex:1 1 auto;min-width:0}.fd-title{display:flex;align-items:center;gap:8px;margin-bottom:5px;min-width:0}
.where{font:600 12px/1 ui-monospace,Consolas,monospace;color:var(--dim);background:#140d24;padding:3px 6px;
box-shadow:0 0 0 1px #3a2a5c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}.where[hidden]{display:none}
@container (max-width:420px){.fd-head h2{display:none}}
.status{font-size:13px;color:var(--dim);display:flex;align-items:center;gap:7px;white-space:nowrap;overflow:hidden;
text-overflow:ellipsis;min-width:0}
.status::before{content:"";flex:0 0 auto;width:8px;height:8px;background:#6b7280;box-shadow:0 0 0 2px #0d0818}
.status.busy::before{background:#fbbf24;animation:blink 1s steps(2) infinite}.status.idle::before{background:#34d399}
@keyframes blink{50%{opacity:.35}}
.log{flex:1 1 auto;min-height:0;overflow:auto;list-style:none;margin:0;padding:14px;display:flex;flex-direction:column;gap:12px;
scrollbar-color:#4a3670 transparent}
.log .empty-note{color:var(--faint);text-align:center;margin:auto 0;font-size:14px}
.msg{max-width:100%;padding:9px 12px 10px;background:#231a3c;box-shadow:0 0 0 2px #0d0818;position:relative}
.msg.claude{border-left:4px solid var(--claude)}
.msg.owner{margin-left:28px;background:#2d2152;border-left:4px solid var(--owner)}
.msg.owner.sending{opacity:.7}.msg.owner.failed{border-left-color:#f87171}
.who{display:flex;align-items:center;gap:8px;margin-bottom:5px}
.who .av{width:20px;height:20px;background:#3a2a5c}
.who .name{--px:1.5px;color:#f3edff;font:700 12px/1 ui-monospace,Consolas,monospace;letter-spacing:.06em}
.msg.claude .who .name{color:#ffc9b3}.msg.owner .who .name{color:#dccfff}
.who time{margin-left:auto;font-size:12px;color:var(--faint);font-variant-numeric:tabular-nums}
.body{overflow-wrap:anywhere}.body p{margin:0 0 .55em}.body p:last-child{margin-bottom:0}.body p.pre{white-space:pre-wrap}
.body p.h{font-weight:700;color:#fff}.body ul,.body ol{margin:.2em 0 .6em;padding-left:1.3em}.body li{margin:.15em 0}
.body code{font:13px/1.45 ui-monospace,"Cascadia Mono",Consolas,monospace;background:#140d24;padding:1px 4px;color:#e9ddff}
.body pre{margin:.4em 0 .7em;padding:9px 10px;background:#110a1f;box-shadow:0 0 0 1px #3a2a5c;overflow:auto;max-height:340px}
.body pre code{background:none;padding:0;white-space:pre}
.body blockquote{margin:.3em 0 .6em;padding-left:10px;border-left:3px solid #4a3670;color:var(--dim)}
.body .link{color:#c4b5fd;text-decoration:underline;text-decoration-color:#6d5bb0;text-underline-offset:2px}
.meta{margin-top:5px;font-size:12px;color:var(--faint)}.msg.failed .meta{color:#fca5a5}
.jump{align-self:center;margin:-46px 0 10px;position:relative;z-index:2;border:0;padding:6px 12px;background:#a78bfa;color:#1a0f2e;
font:700 13px/1 "Segoe UI",system-ui,sans-serif;cursor:pointer;box-shadow:0 0 0 2px #0d0818}
.composer{padding:12px 14px 14px;border-top:2px solid #0d0818;background:#1f1636}
.composer textarea{display:block;width:100%;min-height:46px;max-height:180px;resize:none;padding:10px 12px;background:#120b20;
color:var(--ink);border:0;box-shadow:0 0 0 2px #4a3670;font:15px/1.45 "Segoe UI",system-ui,sans-serif;outline:none}
.composer textarea:focus{box-shadow:0 0 0 2px var(--violet)}
.composer .act{display:flex;align-items:center;gap:10px;margin-top:9px}
.hint{font-size:12px;color:var(--faint)}.count{font-size:12px;color:var(--faint);font-variant-numeric:tabular-nums}.count.over{color:#fca5a5}
.send{margin-left:auto;height:34px;padding:0 16px;border:0;background:#a78bfa;color:#1a0f2e;cursor:pointer;
box-shadow:0 0 0 2px #0d0818,inset 0 -3px 0 #7c5fd6;--px:2px}
.send:hover{background:#b9a2ff}.send:disabled{background:#4a3f6b;color:#8f84b0;cursor:not-allowed;box-shadow:0 0 0 2px #0d0818}
.send .px{height:14px}
.off{margin:0;padding:14px;border-top:2px solid #0d0818;color:var(--dim);font-size:14px;background:#1f1636}
.sky-day,.sky-dusk,.sky-night{display:none}#nr[data-sky=day] .sky-day,#nr[data-sky=dusk] .sky-dusk,#nr[data-sky=night] .sky-night{display:inline}
#nr:not([data-busy="1"]) .nr-typing{display:none}.nr-seat:not(.on) .nr-on{display:none}.nr-seat.on .nr-off{display:none}
.app{transition:grid-template-columns .34s cubic-bezier(.3,.7,.2,1),gap .34s}
body.desk-closed .app{grid-template-columns:minmax(0,1fr) 0px;gap:0;overflow:hidden}
.desk{width:clamp(340px,27vw,520px);justify-self:start;transform-origin:100% 0}
body.desk-closed .desk{visibility:hidden;pointer-events:none}
body.desk-out .desk{animation:swing-out .3s cubic-bezier(.5,0,.8,.4) forwards}
body.desk-in .desk{animation:swing-in .38s cubic-bezier(.2,.9,.3,1.15)}
@keyframes swing-out{to{transform:translateX(70%) rotate(7deg);opacity:0}}
@keyframes swing-in{from{transform:translateX(70%) rotate(7deg);opacity:0}to{transform:none;opacity:1}}
.bell{position:fixed;right:18px;top:12px;z-index:4;display:flex;align-items:center;gap:8px;height:44px;padding:0 10px;border:0;
background:#2b1f4a;color:#f3edff;cursor:pointer;box-shadow:0 0 0 3px #0d0818,0 0 0 5px #4a3670,0 10px 24px #0009;
font:700 13px/1 "Segoe UI",system-ui,sans-serif}
.bell[hidden]{display:none}.bell:hover{background:#3a2a5c}.bell:focus-visible{outline:2px solid #fbbf24;outline-offset:3px}
.bell-ico{width:30px;height:25px;display:block}
.badge{position:absolute;top:-9px;right:-9px;min-width:20px;height:20px;padding:0 5px;background:#ff5c9a;color:#fff;
font:800 12px/20px "Segoe UI",system-ui,sans-serif;text-align:center;box-shadow:0 0 0 2px #0d0818}
.badge[hidden]{display:none}
.bell.ring .bell-ico{animation:ring .7s ease-in-out 2}
@keyframes ring{0%,100%{transform:rotate(0)}15%{transform:rotate(-16deg)}30%{transform:rotate(14deg)}45%{transform:rotate(-10deg)}
60%{transform:rotate(7deg)}75%{transform:rotate(-3deg)}}
.fd-close{align-self:center;flex:0 0 auto;width:32px;height:32px;border:0;background:#3a2a5c;color:#e9ddff;cursor:pointer;
box-shadow:0 0 0 2px #0d0818;display:grid;place-items:center}.fd-close:hover{background:#4a3670}
.fd-close svg{width:12px;height:12px}
@media (max-width:1099px){body.desk-closed .desk{display:none}.bell{position:absolute;right:8px;top:auto;bottom:8px}
body.desk-closed .app{gap:14px}body{overflow:auto}.app{display:flex;flex-direction:column;height:auto;padding:12px;gap:14px}
.floor{display:contents}.bar{order:1}.stage{order:2}.desk{order:3;width:auto;height:72vh;min-height:420px}.board{order:4}
.frame{width:100%}.board{grid-template-columns:1fr;overflow:visible}.col ul{max-height:none}}
@media (max-width:640px){.row{grid-template-columns:10px 70px minmax(0,1fr) 30px}.row em{display:none}
.msg.owner{margin-left:12px}}
@media (prefers-reduced-motion:reduce){.app{transition:none}body.desk-out .desk,body.desk-in .desk,.bell.ring .bell-ico{animation:none}}
.nr-glow{display:none}#nr[data-sky=night] .nr-glow{display:inline}#nr[data-closed="1"] .nr-glow{display:none}
#nr[data-closed="1"] .nr-typing{display:none}
.conf-lit{display:none}#nr[data-meet="on"] .conf-lit{display:inline}#nr[data-meet="on"] .conf-dim{display:none}
${extraCss()}`
}

export function pageHtml(list: Staffer[], now: number, ver: string, where: string): string {
  const working = list.filter(s => !s.isDone)
  const done = list.filter(s => s.isDone)
  const mins = (s: Staffer) => Math.max(0, Math.round(((s.endedAt ?? now) - s.startedAt) / 60_000))
  const row = (s: Staffer, dim: boolean) => `<li><div class="row${dim ? ' done' : ''}${dim && s.isFailed ? ' failed' : ''}">` +
    `<i class="dot ${deptOf(s.desk).id}"></i><b>${esc(deptOf(s.desk).name)}</b>` +
    `<span class="task">${dim && s.isFailed ? 'Failed: ' : ''}${esc(s.task)}</span><em>${dim ? '' : esc(toolLabel(s.tool))}</em>` +
    `<small>${mins(s)}m</small></div></li>`
  const svg = office(list, now, 'page').replace('<svg ', `<svg id="nr" role="img" aria-label="The office" ` +
    `data-sky="${skyOf(localParts(now))}" data-busy="${working.length ? 1 : 0}" data-meet="off" data-closed="0" `)
    .replace(/ width="\d+" height="\d+"/, '')
  const src = (f: string) => `${f}?k=__AOK__&amp;v=${ver}`
  const pixelAv = (who: string) => `<svg class="av" viewBox="1 1 10 10" aria-hidden="true" shape-rendering="crispEdges">` +
    `<use href="#sp-${who}-f0"/></svg>`
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="referrer" content="no-referrer"><meta name="color-scheme" content="dark">' +
    `<link rel="icon" type="image/png" href="${src('icon.png')}"><link rel="stylesheet" href="${src('office.css')}">` +
    `<title>Agent Office</title></head><body><div class="app">` +
    `<section class="floor"><header class="bar"><h1 data-px="Agent Office">Agent Office</h1></header>` +
    `<div class="stage"><div class="frame">${svg}` +
    `<button class="bell" id="fd-bell" type="button" hidden aria-controls="fd-desk" aria-expanded="false" aria-label="Open the front desk">` +
    `${'<svg class="bell-ico" viewBox="0 0 12 10" aria-hidden="true" shape-rendering="crispEdges"><path fill="#1a0f26" d="M5 0h2v1h-2zM3 2h6v1h1v1h1v3h-10v-3h1v-1h1zM0 7h12v2h-12z"/><path fill="#f4c542" d="M4 3h4v1h1v3h-6v-3h1z"/><path fill="#fff2c4" d="M4 4h1v2h-1z"/><path fill="#c9962a" d="M1 8h10v1h-10z"/><path fill="#e2b65e" d="M5 1h2v1h-2z"/></svg>'}` +
    `<span class="badge" id="fd-badge" hidden></span></button></div></div>` +
    `<div class="board" id="nr-board"><div class="col"><h2><span data-px="On the floor">On the floor</span><span class="n" id="nr-n-work">` +
    `${working.length || ''}</span></h2><ul id="nr-work">` +
    `${working.length ? working.map(s => row(s, false)).join('') : '<li class="empty">Nobody at a desk right now.</li>'}</ul></div>` +
    `<div class="col"><h2><span data-px="Handed back">Handed back</span><span class="n" id="nr-n-done">${done.length || ''}</span></h2>` +
    `<ul id="nr-done">${done.length ? done.slice(-6).reverse().map(s => row(s, true)).join('') : '<li class="empty">Nothing handed back yet.</li>'}` +
    `</ul></div></div></section>` +
    `<aside class="desk" id="fd-desk" aria-label="Conversation with Claude">` +
    `<header class="fd-head">${pixelAv('claude')}<div class="fd-id"><div class="fd-title">` +
    `<h2 data-px="Front desk">Front desk</h2><span class="where" id="fd-where" title="This session's folder"${where ? '' : ' hidden'}>` +
    `${esc(where)}</span></div><div class="status" id="fd-status">Claude</div></div>` +
    `<button class="fd-close" id="fd-close" type="button" hidden aria-label="Close the front desk" title="Close (Esc)">` +
    `<svg viewBox="0 0 7 7" aria-hidden="true" shape-rendering="crispEdges"><path fill="currentColor" d="M0 0h2v1h1v1h1v-1h1v-1h2v2h-1v1h-1v1h1v1h1v2h-2v-1h-1v-1h-1v1h-1v1h-2v-2h1v-1h1v-1h-1v-1h-1z"/></svg></button>` +
    `</header>` +
    `<ol class="log" id="fd-log" aria-live="polite"><li class="empty-note" id="fd-empty">` +
    `<noscript>The conversation shows with JavaScript on.</noscript></li></ol>` +
    `<button class="jump" id="fd-jump" type="button" hidden>New messages</button>` +
    `<form class="composer" id="fd-form" hidden><label class="sr" for="fd-text">Message Claude</label>` +
    `<textarea id="fd-text" rows="2" placeholder="Message Claude" autocomplete="off"></textarea>` +
    `<div class="act"><span class="hint">Enter to send · Shift+Enter for a new line</span>` +
    `<span class="count" id="fd-count" hidden></span>` +
    `<button class="send" id="fd-send" type="submit"><span data-px="Send">Send</span></button></div></form>` +
    `<p class="off" id="fd-off">Read-only: chatting needs the local bridge. Run /office in Claude Code.</p></aside></div>` +
    `<script src="${src('layout.js')}"></script><script src="${src('engine.js')}"></script>` +
    `<script src="${src('frontdesk.js')}"></script><script src="${src('conference.js')}"></script>` +
    `<script src="${src('extras.js')}"></script><script src="${src('lofi.js')}"></script></body></html>`
}

// The style of what conference.js and extras.js add to the page (the page's CSP allows no style but this file): the
// front desk's Chat and Meeting tabs and the meeting's panel, the speaker's bubble, the chat box's "Say in meeting",
// the usage gauge beside the title, and the usage notice at the front desk.
function extraCss(): string {
  return `.fd-tabs{flex:0 0 auto;display:flex;align-items:stretch;gap:2px;padding:0 10px;background:#1f1636;border-bottom:2px solid #0d0818;
overflow-x:auto;scrollbar-width:none}.fd-tabs::-webkit-scrollbar{display:none}
.fd-tab{position:relative;flex:0 0 auto;display:flex;align-items:center;gap:7px;height:36px;padding:0 12px;border:0;background:none;
color:#b1a6cf;font:700 13px/1 "Segoe UI",system-ui,sans-serif;white-space:nowrap;cursor:pointer;box-shadow:inset 0 -3px 0 transparent}
.fd-tab:hover{color:#e9ddff}.fd-tab[aria-selected="true"]{color:#f3edff;box-shadow:inset 0 -3px 0 #a78bfa}
.fd-tab:focus-visible{outline:2px solid #a78bfa;outline-offset:-2px}
.udot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#ff5c9a;box-shadow:0 0 0 2px #0d0818}.udot[hidden]{display:none}
.live-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#34d399;animation:mt-pulse 1.6s ease-in-out infinite}
.live-dot[hidden]{display:none}@keyframes mt-pulse{50%{opacity:.35}}
.desk.tab-meet #fd-log,.desk.tab-meet #fd-jump{display:none!important}.desk:not(.tab-meet) #nr-meet{display:none}
.meet{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;background:#1b1330}
.mt-head{flex:0 0 auto;padding:10px 14px 8px;border-bottom:2px solid #0d0818;background:#1f1636}
.mt-top{display:flex;align-items:center;gap:8px;min-width:0}
.mt-title{flex:1 1 auto;min-width:0;margin:0;font:700 15px/1.3 "Segoe UI",system-ui,sans-serif;color:#f3edff;display:-webkit-box;
-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere}
.mt-chip{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;font:700 11px/1 ui-monospace,Consolas,monospace;
letter-spacing:.06em;padding:4px 7px;background:#3a2a5c;color:#e9ddff}
.mt-chip.on{background:#123328;color:#9ff0c9;box-shadow:inset 0 0 0 1px #2f8f6a}
.mt-sub{margin-top:3px;font-size:12px;color:#9a90bf;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mt-sub[hidden]{display:none}
.mt-agenda{list-style:none;margin:7px 0 0;padding:0}.mt-agenda[hidden]{display:none}
.mt-ag{display:grid;grid-template-columns:8px 92px minmax(0,1fr) 14px;align-items:center;gap:8px;height:24px;font-size:13px;color:#b1a6cf}
.mt-ag i{width:8px;height:8px;display:block}
.mt-ag b{font:700 11px/1 ui-monospace,Consolas,monospace;letter-spacing:.06em;color:#9a90bf;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mt-ag span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mt-ag em{font-style:normal;font-size:12px;text-align:right;color:#7d74a0}
.mt-ag.now{color:#fff}.mt-ag.now span{font-weight:700}.mt-ag.now em{color:#34d399}.mt-ag.done span{color:#8a81ad}
.mt-log{flex:1 1 auto;min-height:0;overflow:auto;list-style:none;margin:0;padding:2px 14px 12px;scrollbar-color:#4a3670 transparent}
.mt-line{padding:8px 0 9px;border-bottom:1px solid #2d2250}
.mt-line.now{margin:0 -14px;padding-left:11px;padding-right:14px;background:#241a40;border-left:3px solid #a78bfa}
.mt-who{display:flex;align-items:center;gap:7px;height:18px;min-width:0;white-space:nowrap}
.mt-who i{flex:0 0 auto;width:8px;height:8px}
.mt-who b{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;font:700 13.5px/1 "Segoe UI",system-ui,sans-serif}
.mt-who .dept{flex:0 0 auto;font:700 10.5px/1 ui-monospace,Consolas,monospace;letter-spacing:.06em;color:#9a90bf}
.mt-who .kind{flex:0 0 auto;font:700 10px/1 ui-monospace,Consolas,monospace;letter-spacing:.05em;padding:3px 5px;background:#2d2250;color:#c4b5fd}
.k-proposal .kind{background:#3a2a5c;color:#efe8ff}.k-decision .kind{background:#123328;color:#9ff0c9}
.k-question .kind{background:#3a2e10;color:#fcd98a}
.mt-who time{flex:0 0 auto;margin-left:auto;font-size:11.5px;color:#9a90bf;font-variant-numeric:tabular-nums}
.mt-text{margin:4px 0 0;font-size:14px;line-height:1.42;color:#e9e3fb;overflow-wrap:anywhere;white-space:pre-line}
.mt-text strong{display:block;color:#fff;font-weight:700;margin-bottom:1px}.k-decision .mt-text{color:#e7fbef}
.mt-empty{margin:auto 0;padding:24px 14px;text-align:center;color:#9a90bf;font-size:14px;line-height:1.45}.mt-empty[hidden]{display:none}
.mt-foot{flex:0 0 auto;padding:10px 14px;border-top:2px solid #0d0818;background:#1f1636}.mt-foot[hidden]{display:none}
.mt-foot:has(.mt-call[hidden]):has(.mt-msg:empty){display:none}
.mt-call{display:flex;gap:8px;margin:0}.mt-call[hidden]{display:none}
.mt-call input{flex:1 1 auto;min-width:0;height:36px;padding:0 10px;background:#120b20;color:#efeaff;border:0;
box-shadow:0 0 0 2px #4a3670;font:14px/1 "Segoe UI",system-ui,sans-serif;outline:none}
.mt-call input:focus{box-shadow:0 0 0 2px #a78bfa}
.mt-btn{flex:0 0 auto;height:36px;padding:0 14px;border:0;background:#a78bfa;color:#1a0f2e;font:700 13px/1 "Segoe UI",system-ui,sans-serif;
cursor:pointer;box-shadow:0 0 0 2px #0d0818,inset 0 -3px 0 #7c5fd6;white-space:nowrap}
.mt-btn:hover{background:#b9a2ff}.mt-btn:disabled{background:#4a3f6b;color:#8f84b0;box-shadow:0 0 0 2px #0d0818;cursor:default}
.mt-msg{margin:7px 0 0;font-size:12.5px;color:#b1a6cf}.mt-msg:empty{display:none}
.meet-say{display:inline-flex;align-items:center;gap:8px;height:30px;margin:0 0 8px;padding:0 6px 0 10px;border:0;background:#231a3c;
color:#d9ccff;font:600 13px/1 "Segoe UI",system-ui,sans-serif;white-space:nowrap;cursor:pointer;box-shadow:0 0 0 2px #0d0818}
.meet-say[hidden]{display:none}.meet-say:hover{background:#2d2250}
.meet-say i{width:8px;height:8px;border-radius:50%;background:#6b6385}
.meet-say b{font:700 11px/1 ui-monospace,Consolas,monospace;padding:4px 6px;background:#3a2a5c;color:#d9ccff}
.meet-say[aria-pressed="true"]{background:#123328;color:#c9f7e2;box-shadow:0 0 0 2px #0d0818,inset 0 0 0 1px #2f8f6a}
.meet-say[aria-pressed="true"] i{background:#34d399}.meet-say[aria-pressed="true"] b{background:#34d399;color:#062a1c}
.mt-bub{position:fixed;z-index:5;left:0;top:0;width:max-content;max-width:min(270px,74vw);padding:7px 10px 8px;background:#fffdf6;
color:#2b2342;box-shadow:0 0 0 2px #1a0f26,0 8px 18px #0008;font:600 13.5px/1.38 "Segoe UI",system-ui,sans-serif;pointer-events:none}
.mt-bub[hidden]{display:none}
.mt-bub-who{display:flex;align-items:center;gap:6px;margin-bottom:3px;white-space:nowrap}
.mt-bub-who i{flex:0 0 auto;width:8px;height:8px}.mt-bub-who b{font:800 12.5px/1 "Segoe UI",system-ui,sans-serif}
.mt-bub-who span{font:700 10.5px/1 ui-monospace,Consolas,monospace;letter-spacing:.05em;color:#6b6385}
.mt-bub-who em{margin-left:auto;padding-left:10px;font:700 10.5px/1 ui-monospace,Consolas,monospace;font-style:normal;color:#8a83a3}
.mt-bub p{margin:0;overflow-wrap:anywhere}
.mt-bub::before,.mt-bub::after{content:"";position:absolute;left:var(--tx,50%);width:0;height:0;border-style:solid;border-color:transparent}
.mt-bub::before{bottom:-11px;margin-left:-8px;border-width:9px 8px 0 8px;border-top-color:#1a0f26}
.mt-bub::after{bottom:-7px;margin-left:-6px;border-width:7px 6px 0 6px;border-top-color:#fffdf6}
.mt-bub.below::before{bottom:auto;top:-11px;border-width:0 8px 9px 8px;border-color:transparent transparent #1a0f26}
.mt-bub.below::after{bottom:auto;top:-7px;border-width:0 6px 7px 6px;border-color:transparent transparent #fffdf6}
.mt-bub.side::before{left:auto;bottom:auto;right:-11px;top:var(--ty,50%);margin:-8px 0 0;border-width:8px 0 8px 9px;border-color:transparent transparent transparent #1a0f26}
.mt-bub.side::after{left:auto;bottom:auto;right:-7px;top:var(--ty,50%);margin:-6px 0 0;border-width:6px 0 6px 7px;border-color:transparent transparent transparent #fffdf6}
.ro{display:flex;align-items:center;gap:18px;margin-left:auto;min-width:0;font:13px/1.2 "Segoe UI",system-ui,sans-serif;white-space:nowrap}
.ro-g{display:inline-flex;align-items:baseline;gap:6px}.ro-g[hidden],.ro-r[hidden],.ro-bar[hidden]{display:none}
.ro-l{color:#b9afd6}.ro-r{color:#a59bc8}.ro-n{font:700 17px/1 ui-monospace,Consolas,monospace;color:#f3efff}
.ro-ctx .ro-n{font-size:14px}.ro-ctx.ok .ro-n{color:#d4ccef}
.ro-g.none .ro-n{color:#7d74a0}.ro-g.amber .ro-n{color:#fbbf24}.ro-g.red .ro-n{color:#ff8080}
.ro-bar{align-self:center;display:block;width:46px;height:6px;background:#2d2250;box-shadow:0 0 0 1px #0d0818}
.ro-bar i{display:block;height:100%;background:#a99fd0}.ro-main.amber .ro-bar i{background:#fbbf24}.ro-main.red .ro-bar i{background:#f87171}
@media (min-width:1100px){body.desk-closed .ro{margin-right:78px}}
@media (max-width:640px){.ro{gap:12px}.ro-r,.ro-bar{display:none!important}}
.lofi{display:flex;gap:6px;align-items:center;flex:0 0 auto}
.lofi button{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;padding:0 10px;border:0;cursor:pointer;
background:#3a2a5c;color:#e9ddff;font:600 12px/1 "Segoe UI",system-ui,sans-serif;box-shadow:0 0 0 2px #0d0818;white-space:nowrap}
.lofi button:hover{background:#4b3a78}.lofi button:focus-visible{outline:2px solid #a78bfa;outline-offset:2px}
.lofi button[aria-pressed="true"]{background:#a78bfa;color:#1a0f2e}.lofi button[hidden]{display:none}
.lofi .lf-mute{width:28px;padding:0}.lofi .lf-mute .x{display:none}.lofi .lf-mute.muted .x{display:inline}
.lofi .lf-mute.muted .w{display:none}.lofi .lf-mute.muted{background:#5b2140;color:#ffd1e3}
.use-note{flex:0 0 auto;display:flex;align-items:center;gap:9px;min-height:34px;padding:5px 14px;background:#2e2410;
border-bottom:2px solid #0d0818;color:#f6e3b4;font-size:13px;line-height:1.3}.use-note[hidden]{display:none}
.use-note b{flex:0 0 auto;font:700 12px/1 ui-monospace,Consolas,monospace;color:#1a0f2e;background:#fbbf24;padding:4px 6px}
.use-note.shut b{background:#f87171}
.use-note span{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.use-note em{flex:0 0 auto;font-style:normal;font-size:12px;color:#e8c46a}
.status.shut::before{background:#6b6385}
@media (prefers-reduced-motion:reduce){.live-dot{animation:none}}`
}

// the agents' sprites for the page: their walking frames, keyed by their look
export function agentSprites(shown: Staffer[], keyOf: (s: Staffer) => string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const s of shown) out[keyOf(s)] = spriteSet(agentLook(s.id, deptOf(s.desk).color), WALK_FRAMES)
  return out
}
