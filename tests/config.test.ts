import { expect, test } from 'claude-code/testing'

import { MAX_DEPARTMENTS, parseConfig, routeAgent } from '../hooks/config'
import { buildPlan } from '../hooks/plan'

test('no file is the neutral defaults', async () => {
  const { config, warnings } = parseConfig(undefined)
  expect(warnings.length).toBe(0)
  expect(config.owner.name).toBe('You')
  expect(config.departments.map(d => d.name)).toEqual(['Engineering', 'Review', 'Design', 'Research'])
  expect(config.pets.map(p => `${p.name}:${p.coat}`)).toEqual(['Pixel:short', 'Noodle:long'])
  expect(config.staff.length).toBe(6)
})

test('a broken file falls back field by field and says why', async () => {
  const { config, warnings } = parseConfig(JSON.stringify({
    owner: { name: '<script>alert(1)</script>', look: { skin: 'green', top: 'red' } },
    departments: [{ name: '' }, { name: 'Ok', color: 'javascript:1', keywords: [1, 'x', 'fine'] }],
    routing: 'random', pets: 'lots', staff: [42, { name: 'Ada' }], extra: true,
  }))
  expect(config.owner.name).toBe('You')
  expect(config.owner.look.skin).toBe('light')
  expect(config.departments.length).toBe(1)
  expect(config.departments[0]!.name).toBe('Ok')
  expect(config.departments[0]!.color).toMatch(/^#[0-9a-f]{6}$/)
  expect(config.departments[0]!.keywords).toEqual(['fine'])
  expect(config.routing).toBe('match')
  expect(config.pets.length).toBe(2)
  expect(config.staff.map(s => s.name)).toEqual(['Ada'])
  expect(warnings.length > 5).toBe(true)
})

test('names in scripts with combining marks are kept; a pile of marks is not', async () => {
  const name = (n: string) => parseConfig(JSON.stringify({ owner: { name: n } }))
  for (const n of ['अमित', 'มานิต', 'क्षितिज', 'שָׁלוֹם', 'Zoë', 'Nguyễn Văn An']) {
    const { config, warnings } = name(n)
    expect(config.owner.name).toBe(n.normalize('NFC'))
    expect(warnings.length).toBe(0)
  }
  for (const n of ['a\u0301\u0301\u0301\u0301\u0301b', '\u0301abc', 'ab \u0301c']) {
    const { config, warnings } = name(n)
    expect(config.owner.name).toBe('You')
    expect(warnings.join(' ')).toMatch(/may hold only/)
  }
})

test('not JSON, not an object, or too big: the defaults', async () => {
  expect(parseConfig('{ nope').config.departments.length).toBe(4)
  expect(parseConfig('[1,2]').config.owner.name).toBe('You')
  expect(parseConfig('x'.repeat(70_000)).warnings[0]).toMatch(/larger/)
})

test('lists are capped: 8 departments, 12 staff, 4 pets', async () => {
  const many = (n: number, f: (i: number) => unknown) => Array.from({ length: n }, (_, i) => f(i))
  const { config, warnings } = parseConfig(JSON.stringify({
    departments: many(11, i => ({ name: `Dept ${i}` })),
    staff: many(20, i => `S${i}`),
    pets: many(9, i => ({ name: `P${i}` })),
  }))
  expect(config.departments.length).toBe(MAX_DEPARTMENTS)
  expect(config.staff.length).toBe(12)
  expect(config.pets.length).toBe(4)
  expect(warnings.length).toBe(3)
})

test('routing: agent type first, then keywords, then in turn', async () => {
  const { config } = parseConfig(undefined)
  expect(routeAgent(config, { type: 'Explore', text: 'fix the bug' }, 0)).toBe(3)
  expect(routeAgent(config, { type: 'custom', text: 'Review the auth change' }, 0)).toBe(1)
  expect(routeAgent(config, { text: 'zzz' }, 6)).toBe(2)
  const rr = parseConfig(JSON.stringify({ routing: 'round-robin' })).config
  expect([0, 1, 2, 3, 4].map(i => routeAgent(rr, { type: 'Explore', text: 'review' }, i))).toEqual([0, 1, 2, 3, 0])
})

test('every department count from 1 to 8 lays out a floor where every seat can be walked to', async () => {
  for (let n = 1; n <= 8; n++) {
    const { config } = parseConfig(JSON.stringify({
      departments: Array.from({ length: n }, (_, i) => ({ name: `Department ${i + 1}` })),
      staff: Array.from({ length: 12 }, () => ''), pets: Array.from({ length: 4 }, (_, i) => ({ name: `P${i}` })),
    }))
    const p = buildPlan(config)
    expect(p.depts.length).toBe(n)
    const adj = new Map<string, string[]>()
    for (const [a, b] of p.edges) {
      adj.set(a, [...(adj.get(a) ?? []), b])
      adj.set(b, [...(adj.get(b) ?? []), a])
    }
    const seen = new Set(['out'])
    const todo = ['out']
    while (todo.length) for (const m of adj.get(todo.pop()!) ?? []) if (!seen.has(m)) { seen.add(m); todo.push(m) }
    for (const d of p.depts) {
      for (let i = 0; i < d.seats; i++) expect(seen.has(`${d.id}-s${i}`)).toBe(true)
      for (const o of p.overflow[d.id] ?? []) expect(seen.has(o)).toBe(true)
    }
    for (const c of p.crew) expect(seen.has(`home-${c.id}`)).toBe(true)
    for (const id of Object.keys(p.spots)) expect(seen.has(`spot-${id}`)).toBe(true)
    expect(seen.has('den-owner')).toBe(true)
    for (const [x, y] of Object.values(p.nodes)) {
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true)
      expect(x >= 0 && x <= p.AW).toBe(true)
    }
    // the pets' graph reaches every spot they settle on
    const cadj = new Map<string, string[]>()
    for (const [a, b] of p.cat.edges) {
      cadj.set(a, [...(cadj.get(a) ?? []), b])
      cadj.set(b, [...(cadj.get(b) ?? []), a])
    }
    const cseen = new Set(['c-den-bed'])
    const ctodo = ['c-den-bed']
    while (ctodo.length) for (const m of cadj.get(ctodo.pop()!) ?? []) if (!cseen.has(m)) { cseen.add(m); ctodo.push(m) }
    for (const s of Object.values(p.cat.spots)) expect(cseen.has(s.node)).toBe(true)
  }
})

test('the soundtrack toggle is shown by default and the config can hide it', async () => {
  expect(parseConfig(undefined).config.soundtrack).toEqual({ enabled: true })
  expect(parseConfig(JSON.stringify({ soundtrack: { enabled: false } })).config.soundtrack).toEqual({ enabled: false })
  const bad = parseConfig(JSON.stringify({ soundtrack: 'loud' }))
  expect(bad.config.soundtrack).toEqual({ enabled: true })
  expect(bad.warnings[0]).toMatch(/soundtrack/)
})

test("Claude's look can be changed, its name can't", async () => {
  expect(parseConfig(undefined).config.claude.look.hoodie).toBe('#d97757')
  const r = parseConfig(JSON.stringify({ claude: { name: 'Hal', look: { top: '#22c55e', style: 'bun', glasses: true } } }))
  expect(r.config.claude.look).toMatchObject({ hoodie: '#22c55e', style: 'bun', glasses: true, skin: 'light' })
  expect(r.warnings.join(' ')).toMatch(/claude\.name: Claude keeps its name/)
  expect(parseConfig(JSON.stringify({ claude: 'red' })).warnings[0]).toMatch(/claude: must be an object/)
})
