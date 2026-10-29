import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { Step } from '../types'

const PANE = 'a11y-flow'
/** The plugin's own command file (commands/flow.md) names it; a mod cannot register a name with `:`. */
const TOGGLE = 'a11y:flow'

const STEPS: { step: Step; help: string }[] = [
  { step: 'a11y:audit', help: 'аудит WCAG → звіт і elements/*.json' },
  { step: 'a11y:lab', help: 'лабораторія контрасту → lab.html' },
  { step: 'a11y:record', help: 'записати вибір у документ рішень' },
]

const isStep = (name: string): name is Step => STEPS.some(s => s.step === name)

const current = atom({ plugin: 'a11y', key: 'current' } as const, null)
const ran = atom({ plugin: 'a11y', key: 'ran' } as const, [])
const isOpen = atom({ plugin: 'a11y', key: 'isOpen' } as const, false)
const auditDone = atom({ plugin: 'a11y', key: 'auditDone' } as const, false)

/** The line /a11y:audit ends its last answer with (skills/audit/SKILL.md, section 6). */
const AUDIT_DONE = '[a11y:audit] завершено'

/** The one step a button may start now, if any: audit before anything ran, lab once the audit is done and before lab ran. */
const startable = (done: Step[], isAuditDone: boolean): Step | null => {
  if (done.length === 0) return 'a11y:audit'
  if (isAuditDone && !done.includes('a11y:lab')) return 'a11y:lab'
  return null
}

/** Marks a step started: it becomes the current one and joins those that ran. */
async function mark($: Parameters<Hook<'command.run'>>[0], step: Step) {
  await update($, current, () => step)
  await update($, ran, was => (was.includes(step) ? was : [...was, step]))
}

/** Column width of the command name, in cells. */
const STEP_W = 15

export const register: Register = on => {
  // A typed /a11y:audit does not always reach command.run (the desktop app sends it as a prompt),
  // but every surface expands the skill through skill.prompt: that is where a step is marked.
  on('skill.prompt', async ($, e, next) => {
    const name = e.skill.includes(':') ? e.skill : `${e.pluginName ?? ''}:${e.skill}`
    if (isStep(name)) await mark($, name)
    return next(e)
  })

  on('command.run', async ($, e, next) => {
    if (isStep(e.command)) await mark($, e.command)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.answer.includes(AUDIT_DONE) && (await read($, current)) === 'a11y:audit') {
      await update($, auditDone, () => true)
    }
    return result
  })

  on('command.run', { command: TOGGLE }, async $ => {
    if (await read($, isOpen)) {
      await $.ui.close({ id: PANE })
      await update($, isOpen, () => false)
      return { text: 'Панель a11y закрито.' }
    }
    await $.ui.open({ id: PANE, title: 'a11y' })
    await update($, isOpen, () => true)
    return { text: 'Панель a11y відкрито. /a11y:flow закриває її.' }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny === undefined) await update($, isOpen, () => false)
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const now = await read($, current)
    const done = await read($, ran)
    const next = startable(done, await read($, auditDone))
    // As if the person typed it: the command.run hook above marks the step.
    const onStart = async () => {
      if (next !== null) await $.command.run({ command: next, args: '' })
    }
    return (
      <Box flexDirection="column">
        {STEPS.map(({ step, help }) => {
          const isCurrent = step === now
          const wasRun = done.includes(step)
          return (
            <Box flexDirection="row">
              <Box width={2} flexShrink={0}>
                <Text bold={isCurrent} dimColor={!isCurrent && !wasRun}>
                  {isCurrent ? '▶' : wasRun ? '✓' : ''}
                </Text>
              </Box>
              <Box width={STEP_W} flexShrink={0}>
                <Text bold={isCurrent} dimColor={!isCurrent && !wasRun}>/{step}</Text>
              </Box>
              <Text dimColor={!isCurrent} wrap="truncate-end">
                {help}
              </Text>
            </Box>
          )
        })}
        {next !== null && Button ? (
          <Box marginTop={1}>
            <Button key="start" label={`Запустити /${next}`} onPress={onStart} />
          </Box>
        ) : null}
      </Box>
    )
  })
}
