import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'agent-office',
  component: 'Pane',
  requestId: 'agent-office',
  props: {
    title: 'Agent Office',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const NOW = 1_800_000_000_000

test('the pane draws an empty office on every surface', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Nobody at a desk/ }))?.text).toBe('Nobody at a desk right now')
    expect((await ui.find({ type: 'Text', text: /Inbox/ }))?.text).toBe('Inbox: 0 handed back')
    await ui.unmount()
  }
})

test('an agent in the stored list shows under its department', async ($, on) => {
  const agent = { id: 'x1', task: 'Review the login flow', desk: 'd1', isDone: false, isFailed: false, startedAt: NOW - 120_000 }
  on('clock.now', () => ({ value: NOW }))
  on('state.get', (_, e) => (e.key === 'staff'
    ? { value: { value: { shape: 'staff-1', value: [agent] }, version: 1 } }
    : { value: { value: undefined, version: 0 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /At their desks/ }))?.text).toBe('At their desks (1)')
  expect((await ui.find({ type: 'Text', text: /Review the login flow/ }))?.text).toMatch(/^Review +Review the login flow/)
  await ui.unmount()
})

test('the pane leads with the usage gauge, and says when the office is closed', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  const resets = new Date(NOW + 3_600_000).toISOString()
  mock.store(on, { usageMem: { warned: ['five_hour|' + resets], last: [{ kind: 'five_hour', percentUsed: 99, resetsAt: resets }],
    closed: { kind: 'five_hour', key: 'five_hour|' + resets, at: NOW, why: 'limit', until: NOW + 3_600_000 } } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^Office closed until \d{1,2}:\d{2} [AP]M/ }))?.text).toMatch(/until/)
  expect((await ui.find({ type: 'Text', text: /^5-hour 99%$/ }))?.text).toBe('5-hour 99%')
  await ui.unmount()
})

test('a handed-back report is labelled as one, never read as someone still working', async ($, on) => {
  const done = { id: 'x2', task: 'List and describe folder files', desk: 'd3', isDone: true, isFailed: false,
    startedAt: NOW - 20_000, endedAt: NOW - 5_000 }
  on('clock.now', () => ({ value: NOW }))
  on('state.get', (_, e) => (e.key === 'staff'
    ? { value: { value: { shape: 'staff-1', value: [done] }, version: 1 } }
    : { value: { value: undefined, version: 0 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Nobody at a desk/ }))?.text).toBe('Nobody at a desk right now')
  expect((await ui.find({ type: 'Text', text: /Handed back:/ }))?.text).toBe('Handed back: Research · List and describe folder files · took under 1m')
  await ui.unmount()
})
