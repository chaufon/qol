import { expect, test } from 'claude-code/testing'

import type { Request } from '../types'
import { quote, toPrompt, toRequest, toUsage, upsertConversation, upsertPrompts, upsertRequests } from './sql'

const request = (model: string): Request => ({
  messageId: 'm1', requestId: 'r1', agentId: null, at: 1000, model, isFast: false,
  tokens: { input: 1, cacheWrite5m: 2, cacheWrite1h: 3, cacheRead: 4, output: 5 },
  tools: ['Read'], toolUseIds: ['t1'],
})

test('quote doubles single quotes', () => {
  expect(quote("it's")).toBe("'it''s'")
})

test('quote writes NULL and numbers', () => {
  expect(quote(null)).toBe('NULL')
  expect(quote(12)).toBe('12')
  expect(quote(0.5)).toBe('0.5')
})

test('quote refuses a number that is not finite', () => {
  expect(() => quote(Infinity)).toThrow()
  expect(() => quote(NaN)).toThrow()
})

test('an unknown model is stored with NULL costs', () => {
  const sql = upsertRequests('c1', [request('mystery-model')])
  expect(sql).toContain('NULL, NULL, NULL, NULL')
  expect(sql).toContain('ON CONFLICT')
})

test('a known model is stored with costs', () => {
  const sql = upsertRequests('c1', [request('claude-opus-5')])
  expect(sql).not.toContain('NULL, NULL, NULL, NULL')
})

test('no rows give no statement', () => {
  expect(upsertRequests('c1', [])).toBe('')
})

test('the conversation upsert quotes its text', () => {
  const sql = upsertConversation({ id: 'c1', project: "/a/it's", title: 't', startedAt: 5, requests: [], subagents: [], prompts: [] })
  expect(sql).toContain("'/a/it''s'")
})

test('toUsage gives a null cost when no request has a price', () => {
  const usage = toUsage({
    input: 1, cache_write_5m: 2, cache_write_1h: 3, cache_read: 4, output: 5,
    cost_input: null, cost_cache_write: null, cost_cache_read: null, cost_output: null, cost_count: 0,
  })
  expect(usage.cost).toBe(null)
  expect(usage.tokens.cacheWrite1h).toBe(3)
})

test('toUsage sums the cost parts into a total', () => {
  const usage = toUsage({
    input: 0, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0, output: 0,
    cost_input: 1, cost_cache_write: 2, cost_cache_read: 3, cost_output: 4, cost_count: 2,
  })
  expect(usage.cost).toEqual({ input: 1, cacheWrite: 2, cacheRead: 3, output: 4, total: 10 })
})

test('toRequest parses the JSON arrays', () => {
  const r = toRequest({
    message_id: 'm1', request_id: 'r1', agent_id: null, at: 1000, model: 'x', is_fast: 1,
    input: 1, cache_write_5m: 2, cache_write_1h: 3, cache_read: 4, output: 5,
    tools: '["Read","Agent"]', tool_use_ids: '["t1"]',
  })
  expect(r.isFast).toBe(true)
  expect(r.agentId).toBe(null)
  expect(r.tools).toEqual(['Read', 'Agent'])
  expect(r.toolUseIds).toEqual(['t1'])
})

test('prompts are stored by conversation and time, with their text quoted', () => {
  const sql = upsertPrompts('c1', [{ at: 5, text: "it's done" }])
  expect(sql).toContain("('c1', 5, 'it''s done')")
  expect(sql).toContain('ON CONFLICT (conversation_id, at)')
  expect(upsertPrompts('c1', [])).toBe('')
  expect(toPrompt({ at: 5, text: 'x' })).toEqual({ at: 5, text: 'x' })
})
