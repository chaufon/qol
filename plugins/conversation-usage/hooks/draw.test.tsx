import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import type { Conversation, HistoryData, Request, Subagent, Tokens } from '../types'
import { barSegments } from './draw'
import { ZERO_TOKENS } from './prices'

const PANE = {
  plugin: 'conversation-usage',
  component: 'Pane',
  requestId: 'conversation-usage',
  props: {
    title: 'Usage', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {},
  },
} as const

const NOW = new Date(2026, 9, 28, 12, 0).getTime()
const tok = (extra: Partial<Tokens>): Tokens => ({ ...ZERO_TOKENS, ...extra })
const req = (id: string, at: number, extra: Partial<Request> = {}): Request => ({
  messageId: `m${id}`, requestId: `r${id}`, agentId: null, at, model: 'claude-sonnet-5', isFast: false,
  tokens: tok({ input: 100, output: 200 }), tools: [], toolUseIds: [], ...extra,
})
const subagents: Subagent[] = [{ agentId: 'A', parentAgentId: null, name: 'Explore the code', toolUseId: 't1' }]
const CONVERSATION: Conversation = {
  id: 'c1', project: '/work/qol', title: 'Build the usage pane', startedAt: NOW - 3_600_000, subagents, prompts: [],
  requests: [
    req('1', NOW - 3_000_000, { tools: ['Agent', 'Read'], toolUseIds: ['t1'], tokens: tok({ cacheWrite5m: 18_400, output: 300 }) }),
    req('2', NOW - 2_000_000, { model: 'mystery-model' }),
    req('a1', NOW - 2_900_000, { agentId: 'A', tools: ['Grep'] }),
  ],
}
const WINDOW = { kind: 'five_hour', start: NOW - 3_600_000, end: NOW + 3_600_000, percentUsed: 10 } as const
const HISTORY: HistoryData = {
  conversations: [{
    id: 'c1', project: '/work/qol', title: 'Build the usage pane', startedAt: NOW - 3_600_000,
    usage: { tokens: tok({ output: 500 }), cost: null }, requestCount: 3,
  }],
  windows: [WINDOW], slices: [],
}

// Stands for the engine's state: reads answer what was set, writes store it.
function seed(on: On, init: Record<string, unknown>) {
  const store = new Map<string, { value: unknown; version: number }>()
  for (const [k, v] of Object.entries(init)) store.set(k, { value: v, version: 1 })
  on('state.get', (_, e) => ({ value: store.get(e.key) ?? { value: undefined, version: 0 } }))
  on('state.set', (_, e) => {
    const version = (store.get(e.key)?.version ?? 0) + 1
    store.set(e.key, { value: e.value, version })
    return { value: { isSet: true, version } }
  })
}

// Presses a button and draws again: nothing beneath the plugin tells the mounted pane its state changed.
async function press($: Engine, ui: { redraw(): Promise<void> }, key: string) {
  await $.ui.press({ plugin: 'conversation-usage', key })
  await ui.redraw()
}

const base = { current: CONVERSATION, now: NOW, windowTotals: [{ window: WINDOW, usage: { tokens: tok({ output: 5 }), cost: null } }] }
const texts = async (ui: { findAll(q: { type: 'Text' }): Promise<{ text?: string | undefined }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map((t) => t.text ?? '').join('\n')

test('the Tokens view shows cache write, the subagent row and its count', async ($, on) => {
  seed(on, { ...base })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const all = await texts(ui)
    expect(all).toContain('18.4k')
    expect(all).toContain('↳')
    expect(all).toContain('Explore the code')
    expect(all).toContain('▸ 1')
    expect(all).toContain('5-hour window (')
    await ui.unmount()
  }
})

test('the Cost view shows amounts and ? for an unknown model', async ($, on) => {
  seed(on, { ...base, view: 'cost' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const all = await texts(ui)
    expect(all).toContain('$')
    expect(all).toContain('?')
    await ui.unmount()
  }
})

test('the Chart view shows the legend and bars', async ($, on) => {
  seed(on, { ...base, view: 'chart' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const all = await texts(ui)
    expect(all).toContain('c.write')
    expect(all).toContain('█')
    await ui.unmount()
  }
})

test('the Both view draws the tokens line and the costs line', async ($, on) => {
  seed(on, { ...base, view: 'both' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const all = await texts(ui)
  expect(all).toContain('18.4k')
  expect(all).toContain('$')
  await ui.unmount()
})

test('barSegments splits by largest remainder and never loses a small bar', () => {
  expect(barSegments({ input: 0, cacheWrite5m: 50, cacheWrite1h: 0, cacheRead: 50, output: 0 }, 100, 10)).toEqual([0, 5, 5, 0])
  const tiny = barSegments({ input: 1, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 }, 1_000_000, 10)
  expect(tiny.reduce((a, b) => a + b, 0)).toBe(1)
  const mix = barSegments({ input: 1, cacheWrite5m: 1, cacheWrite1h: 1, cacheRead: 1, output: 1 }, 5, 10)
  expect(mix.reduce((a, b) => a + b, 0)).toBe(10)
  expect(barSegments(ZERO_TOKENS, 100, 10)).toEqual([0, 0, 0, 0])
})

test('History by date shows Today, the project card and a collapsed conversation', async ($, on) => {
  seed(on, { ...base, tab: 'history', history: HISTORY })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const all = await texts(ui)
    expect(all).toContain('Today · ')
    expect(all).toContain('qol')
    expect(all).toContain('Build the usage pane')
    expect(all).toMatch(/▸ 3/)
    await ui.unmount()
  }
})

test('History names the token columns', async ($, on) => {
  seed(on, { ...base, tab: 'history', history: HISTORY })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const all = await texts(ui)
  for (const n of ['input', 'c.write', 'c.read', 'output', 'total']) expect(all).toContain(n)
  await ui.unmount()
})

test('History names the chart columns', async ($, on) => {
  seed(on, { ...base, tab: 'history', history: HISTORY, view: 'chart' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const all = await texts(ui)
  expect(all).toMatch(/bar +tokens +cost/)
  await ui.unmount()
})

test('History shows Loading… before the data arrives', async ($, on) => {
  seed(on, { ...base, tab: 'history', history: null })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await texts(ui)).toContain('Loading…')
  await ui.unmount()
})

test('History shows an error', async ($, on) => {
  seed(on, { ...base, tab: 'history', history: { error: 'sqlite3 failed' } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await texts(ui)).toContain('sqlite3 failed')
  await ui.unmount()
})

test('History with no stored conversations says so', async ($, on) => {
  seed(on, { ...base, tab: 'history', history: { conversations: [], windows: [], slices: [] } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await texts(ui)).toContain('No stored conversations yet.')
  await ui.unmount()
})

test('the Conversation tab lists prompts, the last one open, and a press closes it', async ($, on) => {
  const prompts = [{ at: NOW - 3_100_000, text: 'Explore the repo' }, { at: NOW - 2_500_000, text: 'Write the fix' }]
  seed(on, { ...base, current: { ...CONVERSATION, prompts } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  let all = await texts(ui)
  expect(all).toContain('prompt / tools')
  expect(all).toContain('Explore the repo')
  expect(all).toContain('Write the fix')
  expect(all).toContain('▸ 2')
  expect(all).toContain('▾ 1')
  expect(all).not.toContain('Agent, Read')
  await press($, ui, 'prompt:2')
  all = await texts(ui)
  expect(all).toContain('▸ 1')
  await press($, ui, 'prompt:1')
  expect(await texts(ui)).toContain('Agent, Read')
  await ui.unmount()
})

test('a conversation with no requests shows zero and the window totals', async ($, on) => {
  seed(on, { ...base, current: { ...CONVERSATION, requests: [] }, notice: 'sqlite3 is missing' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const all = await texts(ui)
  expect(all).toContain('Conversation')
  expect(all).toContain('5-hour window (')
  expect(all).toContain('sqlite3 is missing')
  await ui.unmount()
})

test('a conversation not read yet shows the window totals', async ($, on) => {
  seed(on, { ...base, current: null, view: 'cost' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const all = await texts(ui)
  expect(all).toContain('5-hour window (')
  expect(all).toContain('$0.00')
  await ui.unmount()
})

test('the Prices tab lists every price of a model and the factors', async ($, on) => {
  seed(on, { ...base, tab: 'prices' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const all = await texts(ui)
  expect(all).toContain('USD per million tokens')
  expect(all).toContain('write 1h')
  expect(all).toContain('claude-haiku-5-5')
  expect(all).toContain('$0.125')
  expect(all).toContain('Fast mode on claude-opus-5-5 and claude-opus-5')
  expect(all).not.toContain('Tokens')
  await ui.unmount()
})

test('pressing the subagent row opens its requests behind ┃', async ($, on) => {
  seed(on, { ...base })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await texts(ui)).not.toContain('┃')
  await press($, ui, 'sub:A')
  const all = await texts(ui)
  expect(all).toContain('┃')
  expect(all).toContain('▾ 1')
  await ui.unmount()
})

test('pressing the view switch four times returns to Tokens', async ($, on) => {
  seed(on, { ...base })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await press($, ui, 'view-next')
  expect(await texts(ui)).toContain('$')
  await press($, ui, 'view-next')
  await press($, ui, 'view-next')
  expect(await texts(ui)).toContain('█')
  await press($, ui, 'view-next')
  const all = await texts(ui)
  expect(all).toContain('18.4k')
  expect(all).not.toContain('█')
  await ui.unmount()
})

// Switching to History reads the database: sqlite3 answers the History data.
function answerHistory(on: On) {
  mock.env(on, { HOME: '/home/u' })
  const clock = mock.clock(on)
  const rows = (sql: string) => {
    if (sql.includes('GROUP BY c.id')) {
      const [c] = HISTORY.conversations
      return [{ id: c!.id, project: c!.project, title: c!.title, started_at: c!.startedAt, request_count: 3, output: 500 }]
    }
    if (sql.includes('FROM windows ORDER')) return [{ kind: WINDOW.kind, start: WINDOW.start, end: WINDOW.end, percent_used: 10 }]
    return []
  }
  on('process.run', (_, e) => ({
    value: { exitCode: 0, stdout: JSON.stringify(rows(e.init?.stdin ?? '')), stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  return clock
}

test('the tab and grouping switches change what is drawn', async ($, on) => {
  seed(on, { ...base, history: HISTORY })
  const clock = answerHistory(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await press($, ui, 'tab-history')
  await clock.settle()
  await ui.redraw()
  expect(await texts(ui)).toContain('Today · ')
  await press($, ui, 'group-next')
  expect(await texts(ui)).toContain('Today · ')
  await press($, ui, 'group-next')
  expect(await texts(ui)).toContain('5-hour · ')
  await press($, ui, 'tab-next')
  expect(await texts(ui)).toContain('USD per million tokens')
  await press($, ui, 'tab-next')
  await clock.settle()
  await ui.redraw()
  expect(await texts(ui)).toContain('18.4k')
  await ui.unmount()
})

test('the footer holds the keys of the tab on show, on the last row the pane shows', async ($, on) => {
  seed(on, { ...base, history: HISTORY })
  answerHistory(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const labels = async () => (await ui.findAll({ type: 'Button' })).filter((b) => b.props.hotkey !== undefined).map((b) => b.text)
  expect(await labels()).toEqual(['Tab', 'View', 'Hide'])
  await press($, ui, 'tab-history')
  expect(await labels()).toEqual(['Tab', 'View', 'Group', 'Hide'])
  await press($, ui, 'tab-next')
  expect(await labels()).toEqual(['Tab', 'Hide'])
  const footer = (await ui.findAll({ type: 'Box' })).find((b) => b.props.position === 'absolute')
  expect(footer?.props.top).toBe(29)
  await ui.unmount()
})
