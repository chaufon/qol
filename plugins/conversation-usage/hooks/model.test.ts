import { expect, test } from 'claude-code/testing'

import type { Conversation, HistoryConversation, HistoryData, HistorySlice, Request, Subagent, Tokens, Usage } from '../types'
import { projectColor } from './format'
import { ZERO_TOKENS } from './prices'
import { conversationRows, historyTree, promptGroups, sumUsage } from './model'

const tok = (output: number): Tokens => ({ ...ZERO_TOKENS, output })
const req = (id: string, at: number, extra: Partial<Request> = {}): Request => ({
  messageId: `m${id}`, requestId: `r${id}`, agentId: null, at, model: 'claude-sonnet-5', isFast: false,
  tokens: tok(1000), tools: [], toolUseIds: [], ...extra,
})
const sub = (agentId: string, toolUseId: string | null, parentAgentId: string | null = null): Subagent => ({
  agentId, parentAgentId, name: `agent ${agentId}`, toolUseId,
})
const conv = (requests: Request[], subagents: Subagent[], prompts: Conversation['prompts'] = []): Conversation => ({
  id: 'c1', project: '/a/qol', title: 't', startedAt: 1, requests, subagents, prompts,
})
const shape = (rows: ReturnType<typeof conversationRows>) =>
  rows.map((r) => (r.kind === 'request' ? `${r.number}@${r.depth}` : `${r.agentId}:${r.count}@${r.depth}`))

const base = (): Conversation =>
  conv(
    [
      req('1', 10, { tools: ['Agent'], toolUseIds: ['t1', 't2'] }),
      req('2', 20),
      req('a1', 11, { agentId: 'A', toolUseIds: ['t3'] }),
      req('a2', 12, { agentId: 'A' }),
      req('b1', 13, { agentId: 'B' }),
      req('c1', 14, { agentId: 'C' }),
    ],
    [sub('A', 't1'), sub('B', 't2'), sub('C', 't3', 'A')],
  )

test('subagent rows follow the request that launched them', () => {
  expect(shape(conversationRows(base(), () => false, ''))).toEqual(['1@0', 'A:2@0', 'B:1@0', '2@0'])
})

test('an open subagent lists its requests one level deeper', () => {
  const rows = conversationRows(base(), (k) => k === 'sub:A', '')
  expect(shape(rows)).toEqual(['1@0', 'A:2@0', '1@1', 'C:1@1', '2@1', 'B:1@0', '2@0'])
  expect(rows[1]).toMatchObject({ kind: 'subagent', key: 'sub:A', isOpen: true, name: 'agent A' })
  expect(rows[0]).toMatchObject({ key: 'req:m1|r1', tools: ['Agent'] })
})

test('a nested subagent sits under the request that launched it', () => {
  expect(shape(conversationRows(base(), (k) => k === 'p/sub:A', 'p/'))).toEqual(['1@0', 'A:2@0', '1@1', 'C:1@1', '2@1', 'B:1@0', '2@0'])
  expect(shape(conversationRows(base(), () => true, ''))).toEqual(['1@0', 'A:2@0', '1@1', 'C:1@1', '1@2', '2@1', 'B:1@0', '1@1', '2@0'])
  expect(conversationRows(base(), () => false, 'p/')[1]!.key).toBe('p/sub:A')
})

test('a subagent without a launching request goes last', () => {
  const c = conv([req('1', 10), req('2', 20), req('z1', 15, { agentId: 'Z' })], [sub('Z', 'zz')])
  expect(shape(conversationRows(c, () => false, ''))).toEqual(['1@0', '2@0', 'Z:1@0'])
})

test('range keeps the requests inside it', () => {
  const rows = conversationRows(base(), () => false, '', [15, 30])
  expect(shape(rows)).toEqual(['1@0'])
  expect(rows[0]).toMatchObject({ at: 20 })
})

test('sumUsage prices known models only', () => {
  const known = req('1', 1, { tokens: tok(1_000_000) })
  const synthetic = req('2', 2, { model: '<synthetic>', tokens: tok(500) })
  const u = sumUsage([known, synthetic])
  expect(u.tokens.output).toBe(1_000_500)
  expect(Math.abs(u.cost!.total - 10)).toBeLessThan(1e-9)
  expect(sumUsage([synthetic]).cost).toBe(null)
  expect(sumUsage([]).cost).toBe(null)
})

const usage = (output: number): Usage => ({ tokens: tok(output), cost: null })
const at = (d: number, h: number) => new Date(2026, 9, d, h).getTime()
const hc = (id: string, project: string, startedAt: number, output: number, requestCount = 2): HistoryConversation => ({
  id, project, title: id, startedAt, usage: usage(output), requestCount,
})
const NOW = at(28, 15)

test('by date: newest day open down to project cards, conversations closed', () => {
  const h: HistoryData = {
    conversations: [hc('a', '/a/qol', at(28, 9), 10), hc('b', '/a/web', at(28, 10), 20), hc('c', '/a/qol', at(27, 9), 5)],
    windows: [], slices: [],
  }
  const tree = historyTree(h, 'date', NOW, {})
  expect(tree.map((n) => [n.key, n.kind, n.isOpen, n.label, n.count])).toEqual([
    ['day:2026-10-28', 'day', true, 'Today · Wed 28 Oct', 2],
    ['day:2026-10-27', 'day', false, 'Yesterday · Tue 27 Oct', 1],
  ])
  expect(tree[0]!.usage.tokens.output).toBe(30)
  const cards = tree[0]!.children
  expect(cards.map((n) => [n.key, n.label, n.isOpen, n.count])).toEqual([
    ['day:2026-10-28/project:/a/web', 'web', true, 1],
    ['day:2026-10-28/project:/a/qol', 'qol', true, 1],
  ])
  expect(cards[0]!.color).toBe(projectColor('/a/web'))
  const convNode = cards[1]!.children[0]!
  expect(convNode).toMatchObject({
    key: 'day:2026-10-28/project:/a/qol/conv:a', kind: 'conversation', isOpen: false, count: 2,
    conversationId: 'a', startedAt: at(28, 9), range: null, isContinued: false, color: null,
  })
  expect(tree[0]!.color).toBe(null)
  expect(historyTree(h, 'date', NOW, { 'day:2026-10-28': false })[0]!.isOpen).toBe(false)
  expect(historyTree(h, 'date', NOW, { 'day:2026-10-27': true })[1]!.isOpen).toBe(true)
})

test('by project: projects by latest activity, then days, then conversations', () => {
  const h: HistoryData = {
    conversations: [hc('a', '/a/qol', at(28, 9), 10), hc('b', '/a/web', at(28, 10), 20), hc('c', '/a/qol', at(27, 9), 5)],
    windows: [], slices: [],
  }
  const tree = historyTree(h, 'project', NOW, {})
  expect(tree.map((n) => [n.key, n.isOpen, n.count])).toEqual([['project:/a/web', true, 1], ['project:/a/qol', false, 2]])
  expect(tree[0]!.children[0]!.key).toBe('project:/a/web/day:2026-10-28')
  expect(tree[0]!.children[0]!.isOpen).toBe(true)
  expect(tree[1]!.children.map((n) => n.key)).toEqual(['project:/a/qol/day:2026-10-28', 'project:/a/qol/day:2026-10-27'])
})

const win = (kind: 'five_hour' | 'seven_day', start: number, end: number) => ({ kind, start, end, percentUsed: 0 })
const slice = (windowStart: number, conversationId: string, output: number, requestCount: number): HistorySlice => ({
  kind: 'five_hour', windowStart, conversationId, usage: usage(output), requestCount, firstAt: windowStart,
})

test('by window: week, 5-hour card, conversation slices; later copy is continued', () => {
  const w1 = at(22, 0), w2 = at(29, 0)
  const f1 = at(28, 6), f2 = at(28, 12)
  const h: HistoryData = {
    conversations: [hc('a', '/a/qol', at(28, 8), 99, 5)],
    windows: [win('seven_day', w1, w2), win('five_hour', f1, f1 + 5 * 3_600_000), win('five_hour', f2, f2 + 5 * 3_600_000)],
    slices: [
      slice(f1, 'a', 10, 2), slice(f2, 'a', 20, 3),
      { kind: 'seven_day', windowStart: w1, conversationId: 'a', usage: usage(30), requestCount: 5, firstAt: f1 },
    ],
  }
  const tree = historyTree(h, 'window', NOW, {})
  expect(tree).toHaveLength(1)
  const week = tree[0]!
  expect(week).toMatchObject({ key: `week:${w1}`, kind: 'week', label: '7-day window · Thu 22 Oct → Thu 29 Oct', isNow: true, isOpen: true, count: 2 })
  expect(week.children.map((n) => [n.key, n.label, n.isNow, n.isOpen, n.color])).toEqual([
    [`week:${w1}/fiveHour:${f2}`, '5-hour · 12:00–17:00', true, true, null],
    [`week:${w1}/fiveHour:${f1}`, '5-hour · 06:00–11:00', false, true, null],
  ])
  const later = week.children[0]!.children[0]!
  const earlier = week.children[1]!.children[0]!
  expect(later).toMatchObject({ kind: 'conversation', isContinued: true, count: 3, range: [f2, f2 + 5 * 3_600_000], key: `week:${w1}/fiveHour:${f2}/conv:a`, startedAt: at(28, 8) })
  expect(later.usage.tokens.output).toBe(20)
  expect(earlier).toMatchObject({ isContinued: false, count: 2 })
  expect(earlier.usage.tokens.output).toBe(10)
  expect(week.usage.tokens.output).toBe(30)
})

test('by window: a 5-hour window outside every week is a top-level node after the weeks', () => {
  const f = at(10, 6)
  const h: HistoryData = {
    conversations: [hc('a', '/a/qol', at(10, 7), 1)],
    windows: [win('seven_day', at(22, 0), at(29, 0)), win('five_hour', f, f + 5 * 3_600_000)],
    slices: [slice(f, 'a', 7, 1)],
  }
  const tree = historyTree(h, 'window', NOW, {})
  expect(tree.map((n) => [n.key, n.kind, n.isNow, n.isOpen])).toEqual([
    [`week:${at(22, 0)}`, 'week', true, true],
    [`fiveHour:${f}`, 'fiveHour', false, false],
  ])
})

test('by window: a week counts requests inside the 7-day window but outside every 5-hour window', () => {
  const w = at(22, 0)
  const f = at(28, 6)
  const h: HistoryData = {
    conversations: [hc('a', '/a/qol', at(28, 7), 1)],
    windows: [win('seven_day', w, at(29, 0)), win('five_hour', f, f + 5 * 3_600_000)],
    slices: [
      slice(f, 'a', 7, 1),
      { kind: 'seven_day', windowStart: w, conversationId: 'a', usage: usage(50), requestCount: 4, firstAt: at(23, 0) },
    ],
  }
  const week = historyTree(h, 'window', NOW, {})[0]!
  expect(week.usage.tokens.output).toBe(50)
  expect(week.count).toBe(1)
})

const prompted = (): Conversation => ({
  ...base(),
  requests: [...base().requests, req('3', 30), req('d1', 31, { agentId: 'D' })],
  subagents: [...base().subagents, sub('D', 'unknown')],
  prompts: [{ at: 5, text: 'Fix the bug' }, { at: 25, text: 'Add a test' }],
})

test('without prompts there are no prompt groups', () => {
  expect(promptGroups(base(), () => undefined, '', undefined, true)).toBe(null)
})

test('each prompt groups its requests and the subagents they launched', () => {
  const groups = promptGroups(prompted(), () => undefined, '', undefined, false)!
  expect(groups.map((g) => [g.key, g.number, g.text, g.count])).toEqual([
    ['prompt:1', 1, 'Fix the bug', 6],
    ['prompt:2', 2, 'Add a test', 2],
  ])
  expect(shape(groups[0]!.rows)).toEqual(['1@0', 'A:2@0', 'B:1@0', '2@0'])
  expect(shape(groups[1]!.rows)).toEqual(['1@0', 'D:1@0'])
  expect(groups[0]!.usage.tokens.output).toBe(6000)
  expect(groups.map((g) => g.isOpen)).toEqual([false, false])
})

test('the last prompt is open until it is toggled', () => {
  const open = promptGroups(prompted(), () => undefined, '', undefined, true)!
  expect(open.map((g) => g.isOpen)).toEqual([false, true])
  const closed = promptGroups(prompted(), (k) => (k === 'p/prompt:2' ? false : undefined), 'p/', undefined, true)!
  expect(closed.map((g) => [g.key, g.isOpen])).toEqual([['p/prompt:1', false], ['p/prompt:2', false]])
})

test('requests before the first prompt form group 0, and a range drops empty groups', () => {
  const c = conv([req('0', 1), req('1', 10), req('2', 30)], [], [{ at: 5, text: 'a' }, { at: 25, text: 'b' }])
  const all = promptGroups(c, () => undefined, '', undefined, false)!
  expect(all.map((g) => [g.number, g.at, g.text, g.count])).toEqual([
    [0, null, 'Before the first prompt', 1], [1, 5, 'a', 1], [2, 25, 'b', 1],
  ])
  const ranged = promptGroups(c, () => undefined, '', [20, 40], false)!
  expect(ranged.map((g) => g.number)).toEqual([2])
})

test('a prompt without requests has no group and no number', () => {
  const c = conv([req('1', 10), req('2', 30)], [], [{ at: 5, text: '/clear' }, { at: 8, text: 'a' }, { at: 25, text: 'b' }])
  const groups = promptGroups(c, () => undefined, '', undefined, false)!
  expect(groups.map((g) => [g.key, g.number, g.text])).toEqual([['prompt:2', 1, 'a'], ['prompt:3', 2, 'b']])
})
