import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const NOW = Date.parse('2026-10-28T12:00:00.000Z')
const ROOT = '/home/u/.claude'
const MAIN = `${ROOT}/projects/-work-app/c1.jsonl`
const TRANSCRIPT =
  JSON.stringify({ type: 'user', timestamp: '2026-10-28T09:59:00.000Z', message: { role: 'user', content: 'Hello there' } }) + '\n' +
  JSON.stringify({
    type: 'assistant', requestId: 'req_1', timestamp: '2026-10-28T10:00:00.000Z', cwd: '/work/app',
    message: {
      id: 'msg_1', model: 'claude-opus-5', content: [{ type: 'text', text: 'a' }],
      usage: { input_tokens: 100, output_tokens: 200, cache_creation_input_tokens: 19_300 },
    },
  }) + '\n'

const HISTORY_ROW = { id: 'h1', project: '/work/old', title: 'Old chat', started_at: NOW - 86_400_000, request_count: 2, input: 5 }

const BAND = {
  plugin: 'conversation-usage', component: 'AbovePrompt', requestId: 'band',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const
const PANE = {
  plugin: 'conversation-usage', component: 'Pane', requestId: 'conversation-usage',
  props: { title: 'Usage', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const
const TURN = { answer: 'reply', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const

type Calls = { sqlite: string[]; opened: string[]; closed: string[]; registered: string[]; settle: () => Promise<void> }

// The disk holds one transcript; sqlite3 records its stdin and answers canned rows, or fails to start.
function engine(on: On, options: { isSqliteMissing?: boolean; failFirstSqlite?: boolean; historyId?: string } = {}): Calls {
  const clock = mock.clock(on, { now: NOW })
  const calls: Calls = { sqlite: [], opened: [], closed: [], registered: [], settle: () => clock.settle() }
  mock.env(on, { HOME: '/home/u' })
  let hasFailed = false
  const out = (stdout: string, exitCode = 0) => ({ exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
  on('process.run', (_, e) => {
    if (e.argv[0] === 'sqlite3') {
      if (options.isSqliteMissing) throw new Error('spawn sqlite3 ENOENT')
      if (options.failFirstSqlite && !hasFailed) {
        hasFailed = true
        throw new Error('timed out after 20000ms')
      }
      const sql = e.init?.stdin ?? ''
      calls.sqlite.push(sql)
      if (sql.includes(`WHERE c.id = 'c1'`)) {
        const stale = { project: '/work/app', title: 'Current', started_at: NOW - 1000, message_id: 'm0', request_id: 'r0', at: NOW - 1000, model: 'claude-opus-5', tools: '["StaleTool"]', tool_use_ids: '[]', input: 1 }
        return { value: out(JSON.stringify([stale])) }
      }
      if (sql.includes('FROM conversations c LEFT JOIN requests r ON r.conversation_id = c.id\nGROUP BY')) {
        return { value: out(JSON.stringify([{ ...HISTORY_ROW, id: options.historyId ?? HISTORY_ROW.id }])) }
      }
      return { value: out('') }
    }
    if (e.argv[0] === 'find') return { value: e.argv[1]!.endsWith('/projects') ? out(`${MAIN}\n`) : out('', 1) }
    if (e.argv[0] === 'tail') return { value: out(TRANSCRIPT.slice(Number(e.argv[2]!.slice(1)) - 1)) }
    return { value: out('', 1) }
  })
  on('ui.open', (_, e) => { calls.opened.push(e.id); return { value: { isPlaced: true } } })
  on('ui.close', (_, e) => { calls.closed.push(e.id); return { value: undefined } })
  on('command.register', (_, e) => { calls.registered.push(e.name); return { value: { command: e.name } } })
  on('session.id', () => ({ value: 'c1' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.complete', () => ({ text: 'reply' }))
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'beneath' }))
  return calls
}

// Refreshes run behind the hooks; settle lets them finish.
const begin = async ($: Engine, calls: Calls) => {
  await $.session.start({ cwd: '/work/app', source: 'startup' } as never)
  await $.turn.complete(TURN)
  await calls.settle()
}

type Found = { findAll(q: { type: 'Text' | 'Button' }): Promise<{ text?: string | undefined }[]> }
const textOf = async (ui: Found) =>
  [...(await ui.findAll({ type: 'Text' })), ...(await ui.findAll({ type: 'Button' }))].map((t) => t.text ?? '').join('\n')

const press = async ($: Engine, ui: { redraw(): Promise<void> }, key: string) => {
  await $.ui.press({ plugin: 'conversation-usage', key })
  await ui.redraw()
}

const run = ($: Engine) =>
  $.command.run({ command: 'conversation-usage', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

test('the band shows the total and its button opens and closes the pane', async ($, on) => {
  const calls = engine(on)
  await begin($, calls)
  expect(calls.registered).toEqual(['conversation-usage'])
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await textOf(band)).toContain('Usage · 19.6k tokens · $')
  expect(await textOf(band)).toContain('Show')
  await press($, band, 'conversation-usage-toggle')
  expect(calls.opened).toEqual(['conversation-usage'])
  expect(await textOf(band)).toContain('Hide')
  await press($, band, 'conversation-usage-toggle')
  expect(calls.closed).toEqual(['conversation-usage'])
  expect(await textOf(band)).toContain('Show')
  await band.unmount()
})

test('the band says so before the first request', async ($, on) => {
  engine(on)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await textOf(band)).toContain('Usage · no requests yet')
  await band.unmount()
})

test('with a survey the band is what lies beneath', async ($, on) => {
  const calls = engine(on)
  await begin($, calls)
  const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true }, surface: 'terminal' })
  expect(await textOf(band)).toBe('beneath')
  await band.unmount()
})

test('the command opens the pane and closes it again', async ($, on) => {
  const calls = engine(on)
  await begin($, calls)
  expect(await run($)).toEqual({ text: '' })
  await calls.settle()
  expect(calls.opened).toEqual(['conversation-usage'])
  expect(await run($)).toEqual({ text: '' })
  expect(calls.closed).toEqual(['conversation-usage'])
})

test('without sqlite3 the pane shows the notice and the current conversation', async ($, on) => {
  const calls = engine(on, { isSqliteMissing: true })
  await begin($, calls)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const all = await textOf(pane)
  expect(all).toContain('Usage history needs sqlite3 on the PATH')
  expect(all).toContain('19.3k')
  await pane.unmount()
})

test('a 5-hour reading is stored as a window', async ($, on) => {
  const calls = engine(on)
  await begin($, calls)
  const resetsAt = new Date(NOW + 3_600_000).toISOString()
  await $.session.measure({
    context: { window: 200_000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 12, resetsAt }], changed: ['rateLimits'],
  })
  await calls.settle()
  expect(calls.sqlite.some((sql) => sql.includes('INSERT') && sql.includes('windows'))).toBe(true)
})

test('the History tab queries history and expanding a conversation loads it', async ($, on) => {
  const calls = engine(on)
  await begin($, calls)
  await run($)
  await calls.settle()
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const before = calls.sqlite.length
  await press($, pane, 'tab-next')
  await calls.settle()
  await pane.redraw()
  expect(calls.sqlite.length).toBeGreaterThan(before)
  expect(await textOf(pane)).toContain('Old chat')
  const queries = calls.sqlite.length
  const buttons = await pane.findAll({ type: 'Button' })
  const title = buttons.find((b) => (b.text ?? '').includes('Old chat'))
  expect(title).toBeDefined()
  await $.ui.press({ plugin: 'conversation-usage', key: title!.key as string })
  await calls.settle()
  await pane.redraw()
  expect(calls.sqlite.slice(queries).some((sql) => sql.includes(`WHERE c.id = 'h1'`))).toBe(true)
  await pane.unmount()
})

test('a failed open is retried and History loads once sqlite3 works', async ($, on) => {
  const calls = engine(on, { failFirstSqlite: true })
  await $.session.start({ cwd: '/work/app', source: 'startup' } as never)
  await calls.settle()
  await $.turn.complete(TURN)
  await calls.settle()
  await run($)
  await calls.settle()
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await press($, pane, 'tab-next')
  await calls.settle()
  await pane.redraw()
  expect(await textOf(pane)).toContain('Old chat')
  expect(await textOf(pane)).not.toContain('timed out')
  await pane.unmount()
})

test('an expanded History conversation that is the current one shows the fresh read', async ($, on) => {
  const calls = engine(on, { historyId: 'c1' })
  await begin($, calls)
  await run($)
  await calls.settle()
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await press($, pane, 'tab-next')
  await calls.settle()
  await pane.redraw()
  const buttons = await pane.findAll({ type: 'Button' })
  const title = buttons.find((b) => (b.text ?? '').includes('Old chat'))
  await $.ui.press({ plugin: 'conversation-usage', key: title!.key as string })
  await calls.settle()
  await pane.redraw()
  expect(await textOf(pane)).toContain('StaleTool')
  await $.turn.complete(TURN)
  await calls.settle()
  await pane.redraw()
  expect(await textOf(pane)).not.toContain('StaleTool')
  await pane.unmount()
})
