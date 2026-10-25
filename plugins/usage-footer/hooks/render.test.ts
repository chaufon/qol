import type { RenderElement, SessionMessage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// The children of the footer's root Box.
const row = (el: RenderElement) => ('children' in el ? (el.children ?? []) : [])

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
    expect(await ui.find({ type: 'Box', key: 'context' })).toMatchObject({ text: '120k 60% of 200k ' })
    expect(await ui.find({ type: 'Text', text: ' (60%)' })).toBeUndefined()
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
  expect((await ui.find({ type: 'Text', text: ' 9% of 200k ' }))?.props).toMatchObject({ inverse: true })

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
  const footer = async () => (await ui.find({ type: 'Box' }))?.text ?? ''

  expect(await footer()).toContain('📚 18k')

  await reading(25_000)
  expect(await footer()).toContain('📚 25k')
  await ui.unmount()
})

test('a pointer over the size reveals its share of the window on the row above', async ($, on) => {
  mock.clock(on, { now: new Date(2026, 9, 19, 14, 50).getTime() })
  on('session.measure', ($, e) => ({ changed: e.changed }))

  await $.session.measure({
    context: { tokens: 62_000, window: 200_000, percent: 31 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 42, resetsAt: new Date(2026, 9, 19, 16, 0).toISOString() }],
    changed: ['context', 'rateLimits'],
  })

  const ui = await $.ui.mount({ plugin: 'usage-footer', surface: 'terminal', component: 'SessionMode', props: { modes: ['focus'] } })
  const context = row(await ui.drawn())[1]
  const parts = context === undefined || typeof context === 'string' ? [] : row(context)
  const card = parts.at(-1)

  expect(context).toMatchObject({ type: 'Box', props: { key: 'context' } })
  expect(card).toMatchObject({
    type: 'Box',
    props: { position: 'absolute', top: -1, left: 0, display: 'none' },
    hover: { display: 'flex' },
  })
  expect((await ui.find({ type: 'Text', text: ' 31% of 200k ' }))?.props).toMatchObject({ inverse: true })
  expect(parts[0]).not.toHaveProperty('hover')
  await ui.unmount()
})

test('the 7-day window reveals its reset time on hover', async ($, on) => {
  const now = new Date(2026, 9, 19, 10, 0).getTime()
  mock.clock(on, { now })
  on('session.measure', ($, e) => ({ changed: e.changed }))

  await $.session.measure({
    context: { tokens: 20_000, window: 200_000, percent: 10 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 14, resetsAt: new Date(now + 60 * 60_000).toISOString() },
      { kind: 'seven_day', percentUsed: 42, resetsAt: new Date(2026, 9, 22, 14, 30).toISOString() },
    ],
    changed: ['context', 'rateLimits'],
  })

  const ui = await $.ui.mount({ plugin: 'usage-footer', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  const span = async (text: string) => (await ui.findAll({ type: 'Text', text })).at(-1)?.props
  const week = (await ui.findAll({ type: 'Box' })).find(b => b.key === 'seven-day')

  expect(await span('42%')).toMatchObject({ color: 'success', bold: true })
  expect(week?.children).toContainEqual(
    expect.objectContaining({
      type: 'Box',
      props: expect.objectContaining({ position: 'absolute', display: 'none' }),
      hover: { display: 'flex' },
    }),
  )
  expect(await span(' Resets Thu 14:30 (3d 4h) ')).toMatchObject({ inverse: true })
  await ui.unmount()
})
