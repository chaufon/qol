// Runs the SQL of hooks/sql.ts against a real sqlite3: npx -y tsx plugins/conversation-usage/tests/sql-check.ts
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

import {
  repriceRequests, replacePriceList, SCHEMA, selectConversation, selectHistory, selectPrices, selectPrompts, selectSlices,
  selectSubagents, selectWindows, selectWindowTotal, toHistoryConversation, toPriceRow, toPrompt, toRequest, toSlice,
  toSubagent, toUsage, toWindow, upsertConversation, upsertPrompts, upsertRequests, upsertSubagents, upsertWindow,
} from '../hooks/sql.ts'
import { BUILT_IN, costOf } from '../hooks/prices.ts'

const dir = mkdtempSync(join(tmpdir(), 'cu-sql-'))
const db = join(dir, 'check.db')

const run = (sql: string): Record<string, unknown>[] => {
  const out = execFileSync('sqlite3', ['-json', db], { input: `.timeout 5000\n.bail on\n${sql}`, encoding: 'utf8' }).trim()
  return out === '' ? [] : JSON.parse(out)
}

const tokens = (output: number) => ({ input: 10, cacheWrite5m: 20, cacheWrite1h: 30, cacheRead: 40, output })
const request = (id: string, at: number, output: number) => ({
  messageId: `m${id}`, requestId: `r${id}`, agentId: id === '2' ? 'a1' : null, at, model: 'claude-opus-5', isFast: false,
  tokens: tokens(output), tools: ['Agent', "it's"], toolUseIds: ['toolu_1'],
})
const window = { kind: 'five_hour' as const, start: 1000, end: 6000, percentUsed: 12.5 }
const conversation = {
  id: 'c1', project: '/work/app', title: "Fix the owner's bug", startedAt: 1500,
  requests: [request('1', 2000, 5), request('2', 3000, 7)],
  subagents: [{ agentId: 'a1', parentAgentId: null, name: 'Explore', toolUseId: 'toolu_1' }],
  prompts: [{ at: 1900, text: "Fix the owner's bug" }],
}

try {
  run(SCHEMA)
  run(`BEGIN;\n${replacePriceList(0, 'built-in', 1, BUILT_IN)}\nCOMMIT;`)
  const save = (c: typeof conversation) =>
    run(`BEGIN;\n${upsertConversation(c)}\n${upsertSubagents(c.id, c.subagents)}\n${upsertRequests(c.id, c.requests)}\n${upsertPrompts(c.id, c.prompts)}\n${repriceRequests(c.id)}\nCOMMIT;`)
  save(conversation)
  // The first request again with a different output.
  save({ ...conversation, requests: [request('1', 2000, 50)], subagents: [] })
  run(upsertWindow(window))
  run(upsertWindow({ ...window, percentUsed: 20 }))

  assert.equal(run('SELECT COUNT(*) AS n FROM requests')[0]!.n, 2)
  assert.equal(run('SELECT COUNT(*) AS n FROM subagents')[0]!.n, 1)

  const windows = run(selectWindows()).map(toWindow)
  assert.deepEqual(windows, [{ ...window, percentUsed: 20 }])

  const total = toUsage(run(selectWindowTotal(window))[0]!)
  assert.equal(total.tokens.output, 57)
  assert.equal(total.tokens.input, 20)
  assert.ok(total.cost !== null && total.cost.total > 0)
  const outside = toUsage(run(selectWindowTotal({ ...window, start: 4000, end: 5000 }))[0]!)
  assert.equal(outside.tokens.output, 0)
  assert.equal(outside.cost, null)

  const history = run(selectHistory()).map(toHistoryConversation)
  assert.equal(history.length, 1)
  assert.equal(history[0]!.requestCount, 2)
  assert.equal(history[0]!.title, "Fix the owner's bug")
  assert.equal(history[0]!.usage.tokens.output, 57)

  const slices = run(selectSlices()).map(toSlice)
  assert.equal(slices.length, 1)
  assert.equal(slices[0]!.requestCount, 2)
  assert.equal(slices[0]!.firstAt, 2000)
  assert.equal(slices[0]!.windowStart, 1000)

  const rows = run(selectConversation('c1'))
  assert.equal(rows.length, 2)
  const requests = rows.map(toRequest)
  assert.deepEqual(requests[1]!.tools, ['Agent', "it's"])
  assert.equal(requests[1]!.agentId, 'a1')
  assert.equal(run(selectSubagents('c1')).map(toSubagent)[0]!.name, 'Explore')
  assert.deepEqual(run(selectPrompts('c1')).map(toPrompt), conversation.prompts)
  assert.equal(run(selectConversation('missing')).length, 0)

  // A failing statement inside BEGIN ... COMMIT leaves no row behind.
  assert.throws(() =>
    run(`BEGIN;\n${upsertConversation({ ...conversation, id: 'c2' })}\nINSERT INTO no_such_table VALUES (1);\nCOMMIT;`),
  )
  assert.equal(run("SELECT COUNT(*) AS n FROM conversations WHERE id = 'c2'")[0]!.n, 0)

  // The stored prices read back as written.
  assert.deepEqual(run(selectPrices()).map(toPriceRow), BUILT_IN)

  // The SQL prices every request as costOf does: exact ids, dates, tags, fast mode, long context, dated lists.
  const later = BUILT_IN.map((r) => (r.model === 'claude-opus-5-5' ? { ...r, since: 5000, rates: { ...r.rates, input: 3 } } : { ...r, since: 5000 }))
  run(`BEGIN;\n${replacePriceList(5000, 'downloaded', 5000, later)}\nCOMMIT;`)
  const big = { input: 1_000, cacheWrite5m: 2_000, cacheWrite1h: 3_000, cacheRead: 150_000, output: 4_000 }
  const cases = [
    ['claude-opus-5-5', false, 2000, tokens(9)], ['claude-opus-5-5', false, 6000, tokens(9)], ['claude-opus-5-5', true, 6000, tokens(9)],
    ['claude-opus-5-5[1m]', false, 6000, tokens(9)], ['claude-haiku-4-5-20251001', false, 6000, tokens(9)],
    ['claude-opus-4-5@20251101', false, 6000, tokens(9)], ['claude-opus-4-5-20251101[1m]', false, 6000, tokens(9)],
    ['claude-opus-5-6', false, 6000, tokens(9)], ['claude-fable-5-2', true, 6000, tokens(9)], ['claude-fable-5', false, 6000, big],
    ['claude-haiku-5-5', false, 6000, big], ['claude-haiku-5-5', true, 6000, tokens(9)], ['<synthetic>', false, 6000, tokens(9)],
  ] as const
  const priced = {
    id: 'c3', project: '/work/app', title: 'Prices', startedAt: 1500, subagents: [], prompts: [],
    requests: cases.map(([model, isFast, at, t], i) => ({
      messageId: `p${i}`, requestId: `q${i}`, agentId: null, at, model, isFast, tokens: t, tools: [], toolUseIds: [],
    })),
  }
  save(priced as unknown as typeof conversation)
  const allRows = [...BUILT_IN, ...later]
  for (const r of priced.requests) {
    const stored = run(`SELECT cost_input, cost_cache_write, cost_cache_read, cost_output FROM requests WHERE message_id = '${r.messageId}'`)[0]!
    const expected = costOf(r, allRows)
    const label = `${r.model} fast=${r.isFast} at=${r.at}`
    if (expected === null) {
      assert.equal(stored.cost_input, null, label)
      continue
    }
    for (const [column, value] of [['cost_input', expected.input], ['cost_cache_write', expected.cacheWrite], ['cost_cache_read', expected.cacheRead], ['cost_output', expected.output]] as const) {
      assert.ok(Math.abs(Number(stored[column]) - value) < 1e-12, `${label} ${column}: ${stored[column]} != ${value}`)
    }
  }
  assert.equal(run("SELECT cost_input FROM requests WHERE message_id = 'p7'")[0]!.cost_input, null)

  // A new list prices the stored requests again.
  run(`BEGIN;\n${replacePriceList(5000, 'downloaded', 5000, later.map((r) => ({ ...r, rates: { ...r.rates, output: r.rates.output * 2 } })))}\n${repriceRequests(null)}\nCOMMIT;`)
  const doubled = Number(run("SELECT cost_output FROM requests WHERE message_id = 'p1'")[0]!.cost_output)
  assert.ok(Math.abs(doubled - (9 * 40) / 1e6) < 1e-12, `doubled output: ${doubled}`)

  console.log('sql-check: ok')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
