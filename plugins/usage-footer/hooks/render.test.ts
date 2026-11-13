import type { RenderElement } from 'claude-code'
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

    expect(await span('120k')).toMatchObject({ color: 'warning', weight: 'semibold' })
    expect(await ui.find({ type: 'Box', key: 'context' })).toMatchObject({ text: '120k 60% of 200k ' })
    expect(await ui.find({ type: 'Text', text: ' (60%)' })).toBeUndefined()
    expect(await span('█████████▌')).toMatchObject({ color: 'error' })
    expect(await span(' 95%')).toMatchObject({ color: 'error' })
    expect(await span('(20m)')).toMatchObject({ color: 'error' })
    await ui.unmount()
  }
})

test('a pointer over the size reveals its share of the window on the row above', async ($, on) => {
  mock.clock(on, { now: new Date(2026, 9, 19, 14, 50).getTime() })
  on('session.measure', ($, e) => ({ changed: e.changed }))

  await $.session.measure({
    context: { tokens: 62_000, window: 200_000, percent: 31 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 42, resetsAt: new Date(2026, 9, 19, 16, 0).toISOString() }],
    changed: ['context', 'rateLimits'],
  })

  const ui = await $.ui.mount({
    plugin: 'usage-footer',
    surface: 'terminal',
    component: 'SessionMode',
    props: { modes: ['focus'] },
  })
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

  const ui = await $.ui.mount({
    plugin: 'usage-footer',
    surface: 'terminal',
    component: 'SessionMode',
    props: { modes: [] },
  })
  const span = async (text: string) => (await ui.findAll({ type: 'Text', text })).at(-1)?.props
  const week = (await ui.findAll({ type: 'Box' })).find(b => b.key === 'seven-day')

  expect(await span('42%')).toMatchObject({ color: 'success', weight: 'semibold' })
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
