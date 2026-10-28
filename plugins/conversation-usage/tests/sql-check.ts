// Runs the SQL of hooks/sql.ts against a real sqlite3: npx -y tsx plugins/conversation-usage/tests/sql-check.ts
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

import {
  SCHEMA, selectConversation, selectHistory, selectPrompts, selectSlices, selectSubagents, selectWindows, selectWindowTotal,
  toHistoryConversation, toPrompt, toRequest, toSlice, toSubagent, toUsage, toWindow,
  upsertConversation, upsertPrompts, upsertRequests, upsertSubagents, upsertWindow,
} from '../hooks/sql.ts'

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
  const save = (c: typeof conversation) =>
    run(`BEGIN;\n${upsertConversation(c)}\n${upsertSubagents(c.id, c.subagents)}\n${upsertRequests(c.id, c.requests)}\n${upsertPrompts(c.id, c.prompts)}\nCOMMIT;`)
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

  console.log('sql-check: ok')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
