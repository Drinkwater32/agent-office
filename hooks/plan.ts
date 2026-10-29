// The floor plan, built from the config: the departments down the left (1 to 8 rooms, in columns of two; with an
// odd count the first is one tall room), and beside them the fixed rooms: your office at the top, the lobby with
// Claude's front desk under it, the kitchen and the lounge. Everything is in art pixels (the drawing is 196 tall
// and as wide as the departments need, scaled up twice). People walk a graph of nodes and edges that runs through
// the doorways; the pets have a small graph of their own through your office, the lobby, the lounge and the kitchen.

import type { Look, OfficeConfig, Pet, PetCoat } from './config'

export type Pt = [number, number]
export type Dir = 'up' | 'down' | 'left' | 'right'
export type Pose = 'stand' | 'type' | 'lounge' | 'brew' | 'couch' | 'arcade' | 'foos' | 'beanphone'

export type Dept = {
  id: string; i: number; name: string; label: string; color: string; ink: string
  x: number; y: number; w: number; h: number; face: number; seats: number; tall: boolean
  wall: string; floor: string; theme: number
}
export type Crew = { id: string; name: string; look: Look; dept: Dept; x: number; pose: 'type' | 'lounge' }
export type Spot = { at: Pt; via: string; pose: Pose; dir: Dir; pairs?: string[]; weight: number }
export type CatSpot = { node: string; room: 'den' | 'lobby' | 'lounge' | 'kitchen'; acts: string[]; dir: 'left' | 'right';
  z?: number; who?: number; person?: 'owner'; weight: number }
export type CatFrame = 'w1' | 'w2' | 'sit' | 'front' | 'loaf' | 'curl' | 'groom' | 'stretch' | 'eat'
export type Room = { x: number; y: number; w: number; h: number; face: number }

export type Plan = {
  cfg: OfficeConfig
  depts: Dept[]
  OX: number                         // how far right the fixed rooms sit, past the departments
  AW: number                         // the drawing's width in art pixels
  den: Room; lobby: Room; kitchen: Room; lounge: Room
  nodes: Record<string, Pt>
  edges: [string, string][]
  overflow: Record<string, string[]>
  doors: { x: number; y: number; h: number; color: string }[]   // the doorways drawn between rooms
  crew: Crew[]
  visitor?: Crew                     // the teammate who drops by your office now and then
  dropped: number                    // staff who did not fit
  spots: Record<string, Spot>
  pets: (Pet & { i: number })[]
  cat: { nodes: Record<string, Pt>; edges: [string, string][]; jumps: [string, string][]; spots: Record<string, CatSpot>;
    start: { spot: string; act: CatFrame }[] }
}

export const AH = 196
export const SHIFT = 20   // your office and the lobby are drawn as they were at x 145 and moved over this far
export const DY = 8       // the lobby and the lounge are drawn as they were at y 83 and moved down this far

const LOOKS = [
  { wall: '#45307c', floor: 'nr-oak' }, { wall: '#5e2a3c', floor: 'nr-carpet' }, { wall: '#e9dcc2', floor: 'nr-birch' },
  { wall: '#1f5552', floor: 'nr-sage' }, { wall: '#2f3f6b', floor: 'nr-walnut' }, { wall: '#6b3f5e', floor: 'nr-carpet' },
  { wall: '#3f5a3a', floor: 'nr-birch' }, { wall: '#5a4630', floor: 'nr-oak' },
]

// the ink for text on a color: dark on a light one
export function inkOn(c: string): string {
  const n = parseInt(c.slice(1, 7), 16)
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255]
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#2b1a05' : '#ffffff'
}

// a department's rows: where its workstations' tops are, the walkway in front of them, the passage down its right
export const roomFloor = (d: { y: number; face: number }) => d.y + d.face
export const deskTop = (d: Dept) => roomFloor(d) + 24
export const frontLine = (d: Dept) => deskTop(d) + 21
export const passage = (d: Dept) => d.x + d.w - 6
export const seatX = (d: Dept, i: number) => d.x + 12 + i * 21
export const homeY = (d: Dept) => Math.min(d.y + d.h - 5, frontLine(d) + 27)
const crewRoom = (d: Dept) => Math.max(1, Math.floor((d.w - 20) / 24))

export function buildPlan(cfg: OfficeConfig): Plan {
  const n = cfg.departments.length
  const tallFirst = n % 2 === 1
  const cols = n === 1 ? 1 : Math.ceil(n / 2)
  const blockW = cols <= 2 ? 159 : cols * 78 + (cols - 1) * 3
  const colW = Math.floor((blockW - 3 * (cols - 1)) / cols)
  const extra = blockW - 3 * (cols - 1) - colW * cols
  const OX = 3 + blockW - 162
  const AW = 344 + OX

  // the department rooms, numbered in reading order: the tall room (with an odd count), then the top row left to
  // right, then the bottom row
  const grid: { top?: Dept; bottom?: Dept; tall?: Dept }[] = []
  const slots: { c: number; kind: 'tall' | 'top' | 'bottom'; x: number; w: number }[] = []
  let x = 3
  for (let c = 0; c < cols; c++) {
    const w = colW + (c < extra ? 1 : 0)
    grid.push({})
    if (c === 0 && tallFirst) slots.push({ c, kind: 'tall', x, w })
    else slots.push({ c, kind: 'top', x, w }, { c, kind: 'bottom', x, w })
    x += w + 3
  }
  const rank = { tall: 0, top: 1, bottom: 2 }
  slots.sort((a, b) => rank[a.kind] - rank[b.kind] || a.c - b.c)
  const depts: Dept[] = slots.map((s, k) => {
    const d0 = cfg.departments[k]!
    const look = LOOKS[k % LOOKS.length]!
    const [y, h, face] = s.kind === 'tall' ? [3, 190, 18] : s.kind === 'top' ? [3, 94, 18] : [100, 93, 16]
    const d: Dept = { id: `d${k}`, i: k, name: d0.name, label: d0.name.toUpperCase(), color: d0.color, ink: inkOn(d0.color),
      x: s.x, y, w: s.w, h, face, tall: s.kind === 'tall', seats: Math.max(1, Math.min(6, Math.floor((s.w - 13) / 21))),
      wall: look.wall, floor: look.floor, theme: k % 4 }
    grid[s.c]![s.kind] = d
    return d
  })

  const nodes: Record<string, Pt> = {}
  const edges: [string, string][] = []
  const link = (...ids: string[]) => { for (let i = 1; i < ids.length; i++) edges.push([ids[i - 1]!, ids[i]!]) }
  const X = (p: Pt): Pt => [p[0] + OX, p[1]]

  // the staff: each to a department in turn, as many as a room's front row holds
  const crew: Crew[] = []
  const filled: Record<string, number> = {}
  let dropped = 0
  cfg.staff.forEach((s, i) => {
    let d: Dept | undefined
    for (let t = 0; t < n && !d; t++) {
      const cand = depts[(i + t) % n]!
      if ((filled[cand.id] ?? 0) < crewRoom(cand)) d = cand
    }
    if (!d) return void dropped++
    const slot = filled[d.id] ?? 0
    filled[d.id] = slot + 1
    crew.push({ id: `s${i}`, name: s.name, look: s.look, dept: d, x: d.x + 13 + slot * 24, pose: i % 4 === 3 ? 'lounge' : 'type' })
  })

  // inside each department: the workstations along the back, a corridor behind them, a passage down the right side
  // to the walkway in front of the crew's desks
  const overflow: Record<string, string[]> = {}
  for (const d of depts) {
    const dt = deskTop(d)
    const ly = frontLine(d)
    const px = passage(d)
    const lane: string[] = []
    for (let i = 0; i < d.seats; i++) {
      nodes[`${d.id}-s${i}`] = [seatX(d, i) - 2, dt + 4]
      nodes[`${d.id}-a${i}`] = [seatX(d, i) - 2, dt - 3]
      link(`${d.id}-a${i}`, `${d.id}-s${i}`)
      lane.push(`${d.id}-a${i}`)
    }
    nodes[`${d.id}-cr`] = [px, dt - 3]
    nodes[`${d.id}-pb`] = [px, ly]
    link(...lane, `${d.id}-cr`, `${d.id}-pb`)
    if (d.tall) {                    // a tall room's passage runs on down past both doorways
      nodes[`${d.id}-v77`] = [px, 77]
      nodes[`${d.id}-v137`] = [px, 137]
      nodes[`${d.id}-v172`] = [px, 172]
      link(`${d.id}-pb`, `${d.id}-v77`, `${d.id}-v137`, `${d.id}-v172`)
    }
    // where agents stand by when every seat is taken, each on a spot of its own: first a step below the walkway
    // wherever no crew desk is, then along the walkway itself
    const front: string[] = []
    const over: string[] = []
    const mine = crew.filter(c => c.dept === d)
    const spots: Pt[] = []
    for (let x2 = d.x + 22; x2 <= px - 14; x2 += 13) if (mine.every(c => Math.abs(c.x - x2) >= 9)) spots.push([x2, ly + 9])
    for (let x2 = d.x + (spots.length ? 28 : 20); x2 <= px - 14 && spots.length < 5; x2 += 15) spots.push([x2, ly + 1])
    spots.slice(0, 6).forEach((pt, j) => {
      const id = `${d.id}-o${j}`
      nodes[id] = pt
      over.push(id)
      if (pt[1] === ly + 1) front.push(id)
      else {
        nodes[`${d.id}-oa${j}`] = [pt[0], ly]
        front.push(`${d.id}-oa${j}`)
        link(`${d.id}-oa${j}`, id)
      }
    })
    overflow[d.id] = over
    for (const c of mine) {
      nodes[`home-${c.id}`] = [c.x, homeY(d)]
      nodes[`front-${c.id}`] = [c.x, ly]
      link(`front-${c.id}`, `home-${c.id}`)
      front.push(`front-${c.id}`)
    }
    nodes[`${d.id}-fl`] = [d.x + 6, ly]
    front.push(`${d.id}-fl`)
    front.sort((a, b) => nodes[a]![0] - nodes[b]![0])
    link(...front, `${d.id}-pb`)
  }

  // the doorways: side by side along each row, down the last column, and out of it into the lobby and your office
  const doors: Plan['doors'] = []
  const door = (L: Dept, R: Dept, y: number) => {
    const from = L.tall ? `${L.id}-v${y}` : `${L.id}-dl${y}`
    if (!L.tall) {
      nodes[from] = [passage(L), y]
      link(`${L.id}-pb`, from)
    }
    const to = `${R.id}-dr${y}`
    nodes[to] = [R.x + 6, y]
    link(from, to, `${R.id}-fl`)
    doors.push({ x: L.x + L.w, y: y < 100 ? 63 : 162, h: y < 100 ? 17 : 15, color: '#8d5f37' })
  }
  for (let c = 0; c + 1 < cols; c++) {
    const a = grid[c]!
    const b = grid[c + 1]!
    const top = a.top ?? a.tall
    const bottom = a.bottom ?? a.tall
    if (top && b.top) door(top, b.top, 77)
    if (bottom && b.bottom) door(bottom, b.bottom, 172)
  }
  const last = grid[cols - 1]!
  const lastTop = (last.top ?? last.tall)!
  let exit: string
  if (last.tall) exit = `${last.tall.id}-v137`
  else {
    nodes[`gap-${cols - 1}`] = [passage(last.top!), 98]
    link(`${last.top!.id}-pb`, `gap-${cols - 1}`, `${last.bottom!.id}-cr`)
    exit = `${last.bottom!.id}-cr`
  }

  // the fixed rooms, and the walking graph through them (drawn where they always were, then moved right by OX)
  const den: Room = { x: 165 + OX, y: 3, w: 92, h: 85, face: 18 }
  const lobby: Room = { x: 165 + OX, y: 91, w: 92, h: 102, face: 18 }
  const kitchen: Room = { x: 260 + OX, y: 3, w: 81, h: 85, face: 18 }
  const lounge: Room = { x: 260 + OX, y: 91, w: 81, h: 102, face: 18 }
  const core: Record<string, Pt> = {
    'lobby-w': [171, 137], 'lobby-lw': [178, 149], 'lobby-rc': [207, 154], 'lobby-h0': [198, 154], 'lobby-h1': [216, 154],
    'lobby-en': [207, 186], 'out': [207, 214], 'lobby-e': [250, 160],
    'break-w': [266, 160], 'break-l2': [281, 160], 'break-l1': [281, 150], 'break-ra0': [281, 124],
    'break-c0a': [299, 124], 'break-c1a': [308, 124], 'break-c2a': [317, 124], 'break-ra4': [331, 124],
    'break-rb': [331, 150], 'break-door': [331, 114], 'break-bba': [270, 168],
    'kitchen-door': [331, 74], 'k-1': [323, 74], 'k-0': [290, 74],
    // your office has one door, from the last department; no spot or desk is in there, so only a visit goes in
    'den-gate': [158, 72], 'den-door': [167, 72], 'den-in': [180, 76], 'den-mid': [200, 76], 'den-side': [231, 62],
    'den-owner': [227, 49], 'den-perch': [235, 37],
  }
  for (const [id, p] of Object.entries(core)) nodes[id] = X(p)
  link(exit, 'lobby-w', 'lobby-lw', 'lobby-rc', 'lobby-en', 'out')
  link('lobby-h0', 'lobby-rc', 'lobby-h1')
  link('lobby-rc', 'lobby-e', 'break-w', 'break-l2', 'break-l1', 'break-ra0', 'break-c0a', 'break-c1a', 'break-c2a',
    'break-ra4', 'break-door', 'kitchen-door', 'k-1', 'k-0')
  link('break-l1', 'break-rb', 'break-ra4')
  link('break-w', 'break-bba')
  link(`${lastTop.id}-pb`, 'den-gate', 'den-door', 'den-in', 'den-mid', 'den-side', 'den-owner')
  link('den-side', 'den-perch')
  doors.push({ x: 162 + OX, y: 124, h: 15, color: '#9a88c0' }, { x: 162 + OX, y: 62, h: 16, color: '#3b3452' })

  // the lounge and the kitchen: what there is to do, where you stand for it and which way you face; pairs are the
  // spots whose people talk to each other
  const spots0: Record<string, Spot> = {
    coffee: { at: [290, 40], via: 'k-0', pose: 'brew', dir: 'up', weight: 2 },
    fridge: { at: [333, 52], via: 'kitchen-door', pose: 'brew', dir: 'up', weight: 1 },
    tableL: { at: [293, 58], via: 'k-0', pose: 'stand', dir: 'right', pairs: ['tableR'], weight: 2 },
    tableR: { at: [323, 58], via: 'k-1', pose: 'stand', dir: 'left', pairs: ['tableL'], weight: 2 },
    couch0: { at: [299, 141], via: 'break-c0a', pose: 'couch', dir: 'up', pairs: ['couch1'], weight: 2 },
    couch1: { at: [308, 141], via: 'break-c1a', pose: 'couch', dir: 'up', pairs: ['couch0', 'couch2'], weight: 2 },
    couch2: { at: [317, 141], via: 'break-c2a', pose: 'couch', dir: 'up', pairs: ['couch1'], weight: 2 },
    arcade: { at: [268, 146], via: 'break-l1', pose: 'arcade', dir: 'up', weight: 1.5 },
    foosL: { at: [288, 168], via: 'break-l2', pose: 'foos', dir: 'right', pairs: ['foosR'], weight: 2 },
    foosR: { at: [322, 168], via: 'break-rb', pose: 'foos', dir: 'left', pairs: ['foosL'], weight: 2 },
    bean: { at: [270, 182], via: 'break-bba', pose: 'beanphone', dir: 'down', weight: 1 },
  }
  const spots: Record<string, Spot> = {}
  for (const [id, s] of Object.entries(spots0)) {
    spots[id] = { ...s, at: X(s.at) }
    nodes[`spot-${id}`] = X(s.at)
    link(s.via, `spot-${id}`)
  }

  // the pets' own paths: your office, out its door and down through the last department to the lobby, then the
  // lounge and the kitchen with its bowls
  const catNodes0: Record<string, Pt> = {
    'c-den-door': [166, 74], 'c-den-in': [180, 78], 'c-den-mid': [214, 72], 'c-den-bed': [236, 79], 'c-den-under': [197, 57],
    'c-den-desk': [194, 28], 'c-den-owner': [203, 52], 'c-gate': [158, 76], 'c-gap': [157, 98], 'c-low': [157, 128],
    'c-l1': [171, 138], 'c-l2': [178, 150], 'c-l3': [207, 156], 'c-l4': [250, 161], 'c-lobby-front': [224, 164],
    'c-lobby-bed': [247, 188], 'c-b1': [266, 161], 'c-b2': [281, 161], 'c-b3': [281, 151], 'c-b4': [281, 125],
    'c-b5': [331, 125], 'c-b6': [331, 114], 'c-break-rug': [292, 187], 'c-k0': [331, 77], 'c-k1': [300, 77],
    'c-bowl-0': [267, 74], 'c-bowl-1': [288, 74],
  }
  const catNodes: Record<string, Pt> = {}
  for (const [id, p] of Object.entries(catNodes0)) catNodes[id] = X(p)
  const catEdges: [string, string][] = []
  const catLink = (...ids: string[]) => { for (let i = 1; i < ids.length; i++) catEdges.push([ids[i - 1]!, ids[i]!]) }
  catLink('c-den-bed', 'c-den-mid', 'c-den-in', 'c-den-door', 'c-gate', 'c-gap', 'c-low', 'c-l1', 'c-l2', 'c-l3', 'c-l4',
    'c-b1', 'c-b2', 'c-b3', 'c-b4', 'c-b5', 'c-b6', 'c-k0', 'c-k1', 'c-bowl-1', 'c-bowl-0')
  catLink('c-den-mid', 'c-den-under', 'c-den-desk')
  catLink('c-den-under', 'c-den-owner')
  catLink('c-l3', 'c-lobby-front')
  catLink('c-l4', 'c-lobby-bed')
  catLink('c-b2', 'c-break-rug')
  const catSpots: Record<string, CatSpot> = {
    denBed: { node: 'c-den-bed', room: 'den', acts: ['curl'], dir: 'left', weight: 3 },
    denDesk: { node: 'c-den-desk', room: 'den', acts: ['front', 'loaf', 'sit'], dir: 'right', weight: 2 },
    denMid: { node: 'c-den-mid', room: 'den', acts: ['loaf', 'front', 'groom', 'stretch'], dir: 'left', weight: 2.5 },
    denOwner: { node: 'c-den-owner', room: 'den', acts: ['rub'], dir: 'right', z: 55, person: 'owner', weight: 1 },
    lobbyBed: { node: 'c-lobby-bed', room: 'lobby', acts: ['curl'], dir: 'left', weight: 2.5 },
    lobbyFront: { node: 'c-lobby-front', room: 'lobby', acts: ['front', 'sit', 'groom', 'loaf'], dir: 'right', weight: 2 },
    loungeRug: { node: 'c-break-rug', room: 'lounge', acts: ['loaf', 'curl', 'groom', 'stretch'], dir: 'right', weight: 2 },
    bowl0: { node: 'c-bowl-0', room: 'kitchen', acts: ['eat'], dir: 'right', who: 0, weight: 1 },
    bowl1: { node: 'c-bowl-1', room: 'kitchen', acts: ['eat'], dir: 'right', who: 1, weight: 1 },
  }
  const starts: { spot: string; act: CatFrame }[] = [{ spot: 'denDesk', act: 'front' }, { spot: 'lobbyBed', act: 'curl' },
    { spot: 'denBed', act: 'curl' }, { spot: 'loungeRug', act: 'loaf' }]
  const pets = cfg.pets.map((p, i) => ({ ...p, i }))

  return {
    cfg, depts, OX, AW, den, lobby, kitchen, lounge, nodes, edges, overflow, doors, crew, visitor: crew[0], dropped,
    spots, pets,
    cat: { nodes: catNodes, edges: catEdges, jumps: [['c-den-under', 'c-den-desk']], spots: catSpots,
      start: pets.map((_, i) => starts[i % starts.length]!) },
  }
}

export const petBowl = (i: number) => i % 2
export const coatBuild = (c: PetCoat): 'small' | 'big' => (c === 'long' ? 'big' : 'small')
