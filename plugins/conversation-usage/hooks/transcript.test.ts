import { expect, test } from 'claude-code/testing'

import { completeLines, cwdOf, feed, newTranscript, promptsOf, requestsOf, startedOf, titleOf, utf8Length } from './transcript'

type Opts = {
  id?: string
  requestId?: string
  output?: number
  tools?: string[]
  at?: string
  model?: string
  usage?: Record<string, unknown>
}

const assistant = ({ id = 'msg_1', requestId = 'req_1', output = 1, tools = [], at = '2026-10-28T10:00:00.000Z', model = 'claude-opus-5', usage }: Opts = {}) =>
  JSON.stringify({
    type: 'assistant',
    requestId,
    timestamp: at,
    cwd: '/work/app',
    message: {
      id,
      model,
      usage: usage ?? { input_tokens: 3, cache_creation_input_tokens: 7, cache_read_input_tokens: 5, output_tokens: output },
      content: tools.map((name, i) => ({ type: 'tool_use', id: `toolu_${name}_${i}`, name })),
    },
  })

const lineOf = (value: unknown) => JSON.stringify(value)

test('three lines of one request merge into one request', () => {
  const state = newTranscript(null)
  feed(state, [
    assistant({ output: 10, tools: ['Read'] }),
    assistant({ output: 40, tools: ['Read'], at: '2026-10-28T10:00:01.000Z' }),
    assistant({ output: 40, tools: ['Grep'], at: '2026-10-28T10:00:02.000Z' }),
  ])
  const requests = requestsOf(state)
  expect(requests.length).toBe(1)
  const first = requests[0]!
  expect(first.tools).toEqual(['Read', 'Grep'])
  expect(first.toolUseIds).toEqual(['toolu_Read_0', 'toolu_Grep_0'])
  expect(first.tokens.output).toBe(40)
  expect(first.tokens.input).toBe(3)
  expect(first.tokens.cacheWrite5m).toBe(7)
  expect(first.tokens.cacheRead).toBe(5)
  expect(first.at).toBe(Date.parse('2026-10-28T10:00:00.000Z'))
  expect(first.agentId).toBe(null)
  expect(first.isFast).toBe(false)
})

test('the same request fed in two calls stays one request', () => {
  const state = newTranscript('a1')
  feed(state, [assistant({ output: 10 })])
  feed(state, [assistant({ output: 20 })])
  const requests = requestsOf(state)
  expect(requests.length).toBe(1)
  const first = requests[0]!
  expect(first.tokens.output).toBe(20)
  expect(first.agentId).toBe('a1')
})

test('requests keep the order of first appearance', () => {
  const state = newTranscript(null)
  feed(state, [assistant({ id: 'msg_1', requestId: 'req_1' }), assistant({ id: 'msg_2', requestId: 'req_2' }), assistant({ id: 'msg_1', requestId: 'req_1', output: 9 })])
  expect(requestsOf(state).map((r) => r.messageId)).toEqual(['msg_1', 'msg_2'])
})

test('cache_creation splits the cache write into 5m and 1h', () => {
  const state = newTranscript(null)
  feed(state, [
    assistant({
      usage: {
        input_tokens: 1,
        cache_creation_input_tokens: 150,
        cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 50 },
        cache_read_input_tokens: 0,
        output_tokens: 2,
        speed: 'fast',
      },
    }),
  ])
  const r = requestsOf(state)[0]!
  expect(r.tokens.cacheWrite5m).toBe(100)
  expect(r.tokens.cacheWrite1h).toBe(50)
  expect(r.isFast).toBe(true)
})

test('a synthetic model line is not a request', () => {
  const state = newTranscript(null)
  feed(state, [assistant({ model: '<synthetic>' })])
  expect(requestsOf(state).length).toBe(0)
})

test('blank and invalid lines are skipped', () => {
  const state = newTranscript(null)
  feed(state, ['', '   ', '{not json', assistant()])
  expect(requestsOf(state).length).toBe(1)
})

test('the last custom-title wins over ai-titles', () => {
  const state = newTranscript(null)
  feed(state, [
    lineOf({ type: 'ai-title', aiTitle: 'A' }),
    lineOf({ type: 'custom-title', customTitle: 'B' }),
    lineOf({ type: 'ai-title', aiTitle: 'C' }),
  ])
  expect(titleOf(state)).toBe('B')
})

test('the last ai-title is used when there is no custom-title', () => {
  const state = newTranscript(null)
  feed(state, [lineOf({ type: 'ai-title', aiTitle: 'A' }), lineOf({ type: 'ai-title', aiTitle: 'C' })])
  expect(titleOf(state)).toBe('C')
})

test('without titles the first prompt gives the title, skipping meta and command lines', () => {
  const state = newTranscript(null)
  feed(state, [
    lineOf({ type: 'user', isMeta: true, message: { role: 'user', content: 'meta text' } }),
    lineOf({ type: 'user', message: { role: 'user', content: '<command-name>/x</command-name>' } }),
    lineOf({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Fix the bug\nin parser' }] } }),
    lineOf({ type: 'user', message: { role: 'user', content: 'second prompt' } }),
  ])
  expect(titleOf(state)).toBe('Fix the bug')
})

test('the first-prompt title is cut to 100 characters', () => {
  const state = newTranscript(null)
  feed(state, [lineOf({ type: 'user', message: { role: 'user', content: 'x'.repeat(250) } })])
  expect(titleOf(state)).toBe('x'.repeat(100))
})

test('titleOf is null when nothing is known', () => {
  expect(titleOf(newTranscript(null))).toBe(null)
})

test('cwdOf and startedOf come from the first lines that have them', () => {
  const state = newTranscript(null)
  expect(cwdOf(state)).toBe(null)
  expect(startedOf(state)).toBe(null)
  feed(state, [lineOf({ type: 'ai-title', aiTitle: 'A' }), assistant({ at: '2026-10-28T10:00:00.000Z' }), assistant({ id: 'msg_2', requestId: 'req_2', at: '2026-10-28T11:00:00.000Z' })])
  expect(cwdOf(state)).toBe('/work/app')
  expect(startedOf(state)).toBe(Date.parse('2026-10-28T10:00:00.000Z'))
})

test('completeLines keeps the partial last line as rest', () => {
  expect(completeLines('a\nb\nc')).toEqual({ lines: ['a', 'b'], rest: 'c' })
  expect(completeLines('a\nb\n')).toEqual({ lines: ['a', 'b'], rest: '' })
  expect(completeLines('abc')).toEqual({ lines: [], rest: 'abc' })
})

test('utf8Length counts bytes', () => {
  expect(utf8Length('é€😀')).toBe(9)
  expect(utf8Length('abc')).toBe(3)
})

const user = (content: unknown, extra: Record<string, unknown> = {}, at = '2026-10-28T10:00:00.000Z') =>
  lineOf({ type: 'user', timestamp: at, message: { role: 'user', content }, ...extra })

test('prompts and slash commands of the main transcript are kept with their time', () => {
  const state = newTranscript(null)
  feed(state, [
    user('Fix the bug\nin the parser'),
    user('Base directory for this skill', { isMeta: true }),
    user([{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]),
    user([{ type: 'text', text: '[Request interrupted by user]' }]),
    user('<local-command-caveat>x</local-command-caveat>', { isMeta: true }),
    user('<command-name>/code-review</command-name>\n<command-message>code-review</command-message>\n<command-args>high</command-args>', {}, '2026-10-28T10:05:00.000Z'),
    user('<command-name>/clear</command-name>\n<command-args></command-args>'),
    user('Summary of the conversation', { isCompactSummary: true }),
  ])
  expect(promptsOf(state)).toEqual([
    { at: Date.parse('2026-10-28T10:00:00.000Z'), text: 'Fix the bug' },
    { at: Date.parse('2026-10-28T10:05:00.000Z'), text: '/code-review high' },
    { at: Date.parse('2026-10-28T10:00:00.000Z'), text: '/clear' },
  ])
})

test('a subagent transcript keeps no prompts', () => {
  const state = newTranscript('A')
  feed(state, [user('Explore the code')])
  expect(promptsOf(state)).toEqual([])
})
