import type { SessionContextBreakdown } from 'claude-code'
import type { TestBody } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

type Usage = { window: number; estimate: number }
type TestEngine = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

// Stands in for the engine: a session starts in its folder, commands print
// nothing, and the usage call reads the window and the local estimate the test
// sets.
const engine = (on: On, usage: Usage) => {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('command.run', () => ({ text: '' }))
  on('session.usage', ($, e) => ({
    value: {
      startedAt: 0,
      context: {
        window: usage.window,
        breakdown: e.breakdown === undefined ? undefined : ({ totalTokens: usage.estimate } as SessionContextBreakdown),
      },
      rateLimits: [],
    },
  }))
}

const measured = ($: TestEngine) =>
  $.session.measure({ context: { tokens: 122_000, window: 200_000, percent: 61 }, rateLimits: [], changed: ['context'] })

const footer = async ($: TestEngine) => {
  const ui = await $.ui.mount({ plugin: 'usage-footer', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  const texts = (await ui.findAll({ type: 'Box' }))[0]?.text ?? ''
  await ui.unmount()

  return texts
}

const run = ($: TestEngine, command: string) =>
  $.command.run({ command, args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

for (const command of ['clear', 'rewind', 'resume']) {
  test(`/${command} shows the estimated size of the conversation it leaves`, async ($, on) => {
    mock.clock(on, { now: 0 })
    engine(on, { window: 200_000, estimate: 21_000 })
    await measured($)

    await run($, command)

    expect(await footer($)).toContain('📚 21k 11% of 200k')
  })
}

test('a new session shows the estimated size of its conversation', async ($, on) => {
  mock.clock(on, { now: 0 })
  engine(on, { window: 200_000, estimate: 21_000 })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(await footer($)).toContain('📚 21k 11% of 200k')
})

test('/model keeps the size and measures it against the new window', async ($, on) => {
  mock.clock(on, { now: 0 })
  engine(on, { window: 1_000_000, estimate: 21_000 })
  await measured($)

  await run($, 'model')

  expect(await footer($)).toContain('📚 122k 12% of 1M')
})

test('a choice made in the picker shows on the recount 3 seconds later', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const usage = { window: 200_000, estimate: 122_000 }
  engine(on, usage)
  await measured($)

  await run($, 'resume')
  usage.estimate = 48_000
  await clock.advance(3_000)

  expect(await footer($)).toContain('📚 48k 24% of 200k')
})

test('other commands leave the size alone', async ($, on) => {
  mock.clock(on, { now: 0 })
  engine(on, { window: 200_000, estimate: 21_000 })
  await measured($)

  await run($, 'help')

  expect(await footer($)).toContain('📚 122k 61% of 200k')
})

test('a reading of the conversation /clear left leaves the estimate', async ($, on) => {
  mock.clock(on, { now: 0 })
  engine(on, { window: 200_000, estimate: 21_000 })
  await measured($)

  await run($, 'clear')
  await measured($)

  expect(await footer($)).toContain('📚 21k 11% of 200k')
})

const withWindows = ($: TestEngine) =>
  $.session.measure({
    context: { tokens: 122_000, window: 200_000, percent: 61 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 14, resetsAt: '1970-01-01T05:00:00.000Z' },
      { kind: 'seven_day', percentUsed: 30, resetsAt: '1970-01-08T00:00:00.000Z' },
    ],
    changed: ['context', 'rateLimits'],
  })

test('a reading without rate limits after /clear keeps both windows', async ($, on) => {
  mock.clock(on, { now: 0 })
  engine(on, { window: 200_000, estimate: 21_000 })
  await withWindows($)

  await run($, 'clear')
  await $.session.measure({ context: { tokens: 21_000, window: 200_000, percent: 11 }, rateLimits: [], changed: ['context', 'rateLimits'] })

  expect(await footer($)).toContain(' 14%')
  expect(await footer($)).toContain('🔋 30%')
})

test('a reading without rate limits drops a window that has reset', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  engine(on, { window: 200_000, estimate: 21_000 })
  await withWindows($)

  await clock.advance(5 * 60 * 60_000)
  await $.session.measure({ context: { tokens: 21_000, window: 200_000, percent: 11 }, rateLimits: [], changed: ['context', 'rateLimits'] })

  expect(await footer($)).not.toContain(' 14%')
  expect(await footer($)).toContain('🔋 30%')

  await clock.advance(7 * 24 * 60 * 60_000)
  await $.session.measure({ context: { tokens: 21_000, window: 200_000, percent: 11 }, rateLimits: [], changed: ['context', 'rateLimits'] })

  expect(await footer($)).not.toContain('🔋')
})
