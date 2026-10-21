import type { SessionMessage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

test('the footer draws size, window and reset with their colors', async ($, on) => {
  const now = new Date(2026, 9, 19, 14, 50).getTime()
  mock.clock(on, { now })
  on('session.measure', ($, e) => ({ changed: e.changed }))

  await $.session.measure({
    context: { tokens: 120_000, window: 200_000, percent: 60 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 95, resetsAt: new Date(now + 20 * 60_000).toISOString() }],
    changed: ['context', 'rateLimits'],
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-footer', surface, component: 'SessionMode', props: { modes: [] } })
    const span = async (text: string) => (await ui.findAll({ type: 'Text', text })).at(-1)?.props

    expect(await span('120k')).toMatchObject({ color: 'warning', bold: true })
    expect(await span(' (60%)')).toMatchObject({ dimColor: true })
    expect(await span('█████████▌')).toMatchObject({ color: 'error' })
    expect(await span(' 95%')).toMatchObject({ color: 'error' })
    expect(await span('(20m)')).toMatchObject({ color: 'error' })
    await ui.unmount()
  }
})

test('the footer shows the size a compaction reports until the next response', async ($, on) => {
  mock.clock(on, { now: new Date(2026, 9, 19, 14, 50).getTime() })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  const summary: SessionMessage = { role: 'user', text: 'summary', toolUses: [] }
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  on('session.compact', () => ({ messages: [summary], tokensBefore: 122_000, tokensAfter: 18_000 }))

  await $.session.measure({ context: { tokens: 122_000, window: 200_000, percent: 61 }, rateLimits: [], changed: ['context'] })
  await $.session.compact({ trigger: 'manual', messages: [summary] })

  const ui = await $.ui.mount({ plugin: 'usage-footer', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  const span = async (text: string) => (await ui.findAll({ type: 'Text', text })).at(-1)?.props

  expect(await span('18k')).toMatchObject({ color: 'success', bold: true })
  expect(await span(' (9%)')).toMatchObject({ dimColor: true })

  await $.session.measure({ context: { window: 200_000 }, rateLimits: [], changed: ['rateLimits'] })
  expect(await span('18k')).toMatchObject({ color: 'success' })
  await ui.unmount()
})

test('a reading of the conversation before the compaction leaves the compacted size', async ($, on) => {
  mock.clock(on, { now: new Date(2026, 9, 19, 14, 50).getTime() })
  on('session.measure', ($, e) => ({ changed: e.changed }))
  const summary: SessionMessage = { role: 'user', text: 'summary', toolUses: [] }
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  on('session.compact', () => ({ messages: [summary], tokensBefore: 122_000, tokensAfter: 18_000 }))
  const reading = (tokens: number) =>
    $.session.measure({ context: { tokens, window: 200_000, percent: Math.round(tokens / 2_000) }, rateLimits: [], changed: ['cost'] })

  await reading(122_000)
  await $.session.compact({ trigger: 'manual', messages: [summary] })
  await reading(122_000)

  const ui = await $.ui.mount({ plugin: 'usage-footer', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  const footer = async () => (await ui.findAll({ type: 'Text' }))[0]?.text ?? ''

  expect(await footer()).toContain('📚 18k (9%)')

  await reading(25_000)
  expect(await footer()).toContain('📚 25k (13%)')
  await ui.unmount()
})
