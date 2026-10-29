import { expect, test } from 'claude-code/testing'

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
