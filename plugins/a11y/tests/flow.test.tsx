import { expect, test } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

const PANE = {
  plugin: 'a11y',
  component: 'Pane',
  requestId: 'a11y-flow',
  props: {
    title: 'a11y',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

/** The engine beneath the plugin: each call the mod makes answers as a session would. */
function engine(on: any) {
  const calls: string[] = []
  on('command.run', (_$: any, e: any) => (calls.push(`run ${e.command}`), { text: '' }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.open', (_$: any, e: any) => (calls.push(`open ${e.id}`), { value: { isPlaced: true } }))
  on('ui.close', (_$: any, e: any) => (calls.push(`close ${e.id}`), { value: undefined }))
  return calls
}

const line = async (ui: any, step: string) => (await ui.find({ type: 'Text', text: new RegExp(`^/${step}$`) }))

test('before any step the pane is the help: three commands, none marked', async ($, on) => {
  engine(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    for (const step of ['a11y:audit', 'a11y:lab', 'a11y:record']) expect((await line(ui, step))?.text).toBe(`/${step}`)
    expect(await ui.find({ type: 'Text', text: /аудит WCAG/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^[▶✓]$/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('the step typed last is ▶, the ones before ✓', async ($, on) => {
  engine(on)
  await $.command.run({ command: 'a11y:audit', args: '' } as any)
  await $.command.run({ command: 'a11y:lab', args: 'a11y-audit' } as any)
  await $.command.run({ command: 'a11y:record', args: '' } as any)
  await $.command.run({ command: 'a11y:lab', args: '' } as any)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const marks = (await ui.findAll({ type: 'Text', text: /^[▶✓]$/ })).map((t: any) => t.text)
    expect(marks).toEqual(['✓', '▶', '✓'])
    await ui.unmount()
  }
})

test('/a11y:flow opens the pane, then closes it, without reaching the model', async ($, on) => {
  const calls = engine(on)
  const opened = await $.command.run({ command: 'a11y:flow', args: '' } as any)
  expect(opened.text).toMatch(/відкрито/)
  const closed = await $.command.run({ command: 'a11y:flow', args: '' } as any)
  expect(closed.text).toMatch(/закрито/)
  expect(calls).toEqual(['open a11y-flow', 'close a11y-flow'])
  expect(calls.some(c => c.startsWith('run '))).toBe(false)
})

test('other commands mark nothing', async ($, on) => {
  engine(on)
  await $.command.run({ command: 'spec', args: '796' } as any)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^[▶✓]$/ })).toBeUndefined()
  await ui.unmount()
})

const answer = (text: string, agentId?: string) =>
  ({ answer: text, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', agentId }) as any

const button = (ui: any) => ui.find({ type: 'Button', key: 'start' })

test('before anything ran the button starts the audit', async ($, on) => {
  const calls = engine(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await button(ui))?.props.label).toBe('Запустити /a11y:audit')
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'start' })
  expect(calls).toContain('run a11y:audit')
  await ui.unmount()
})

test('while the audit runs there is no button', async ($, on) => {
  engine(on)
  await $.command.run({ command: 'a11y:audit', args: '' } as any)
  await $.turn.complete(answer('Яку тему перевіряти?'))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await button(ui)).toBeUndefined()
  await ui.unmount()
})

test('the audit done line brings the lab button; it goes once lab starts', async ($, on) => {
  const calls = engine(on)
  await $.command.run({ command: 'a11y:audit', args: '' } as any)
  await $.turn.complete(answer('Звіт: a11y-audit/README.md\n[a11y:audit] завершено'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await button(ui))?.props.label).toBe('Запустити /a11y:lab')
  await ui.press({ key: 'start' })
  expect(calls).toContain('run a11y:lab')
  await ui.unmount()

  await $.command.run({ command: 'a11y:lab', args: '' } as any)
  await $.command.run({ command: 'a11y:record', args: '' } as any)
  const after = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await button(after)).toBeUndefined()
  await after.unmount()
})

test('the done line counts only from the audit, on the main loop', async ($, on) => {
  engine(on)
  await $.command.run({ command: 'a11y:audit', args: '' } as any)
  await $.turn.complete(answer('[a11y:audit] завершено', 'agent-1'))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await button(ui)).toBeUndefined()
  await ui.unmount()
})

const skill = (name: string, pluginName?: string) =>
  ({ skill: name, text: '', frontmatter: {}, source: 'plugin', pluginName }) as any

test('a skill expanded without command.run (the desktop app) marks the step and hides the audit button', async ($, on) => {
  engine(on)
  on('skill.prompt', (_$: any, e: any) => ({ text: e.text }))
  await $.skill.prompt(skill('a11y:audit', 'a11y'))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.findAll({ type: 'Text', text: /^[▶✓]$/ })).map((t: any) => t.text)).toEqual(['▶'])
  expect(await button(ui)).toBeUndefined()
  await ui.unmount()

  await $.turn.complete(answer('[a11y:audit] завершено'))
  const after = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await button(after))?.props.label).toBe('Запустити /a11y:lab')
  await after.unmount()
})

test('a bare skill name from the a11y plugin counts; another plugin\'s does not', async ($, on) => {
  engine(on)
  on('skill.prompt', (_$: any, e: any) => ({ text: e.text }))
  await $.skill.prompt(skill('audit', 'other'))
  const before = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await before.find({ type: 'Text', text: /^[▶✓]$/ })).toBeUndefined()
  await before.unmount()
  await $.skill.prompt(skill('audit', 'a11y'))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await button(ui)).toBeUndefined()
  await ui.unmount()
})
