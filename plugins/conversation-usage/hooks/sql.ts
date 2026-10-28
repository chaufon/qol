import type { Conversation, HistoryConversation, HistorySlice, Prompt, Request, Subagent, Usage, Window, WindowKind } from '../types'
import { costOf } from './prices'

type Row = Record<string, unknown>

export const SCHEMA = `PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, project TEXT NOT NULL, title TEXT NOT NULL, started_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS subagents (agent_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, parent_agent_id TEXT, name TEXT NOT NULL, tool_use_id TEXT);
CREATE TABLE IF NOT EXISTS requests (
  message_id TEXT NOT NULL, request_id TEXT NOT NULL, conversation_id TEXT NOT NULL, agent_id TEXT,
  at INTEGER NOT NULL, model TEXT NOT NULL, is_fast INTEGER NOT NULL,
  input INTEGER NOT NULL, cache_write_5m INTEGER NOT NULL, cache_write_1h INTEGER NOT NULL, cache_read INTEGER NOT NULL, output INTEGER NOT NULL,
  cost_input REAL, cost_cache_write REAL, cost_cache_read REAL, cost_output REAL,
  tools TEXT NOT NULL, tool_use_ids TEXT NOT NULL,
  PRIMARY KEY (message_id, request_id));
CREATE INDEX IF NOT EXISTS requests_at ON requests (at);
CREATE INDEX IF NOT EXISTS requests_conversation ON requests (conversation_id);
CREATE TABLE IF NOT EXISTS prompts (conversation_id TEXT NOT NULL, at INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY (conversation_id, at));
CREATE TABLE IF NOT EXISTS windows (kind TEXT NOT NULL, start INTEGER NOT NULL, "end" INTEGER NOT NULL, percent_used REAL NOT NULL, PRIMARY KEY (kind, start));
`

// Rows per INSERT statement.
const CHUNK = 200

export function quote(v: string | number | null): string {
  if (v === null) return 'NULL'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`Cannot store ${v}`)
    return String(v)
  }
  return `'${v.replaceAll("'", "''")}'`
}

const tuple = (values: (string | number | null)[]) => `(${values.map(quote).join(', ')})`

// One INSERT per chunk of rows; every column outside the key is overwritten on conflict.
function upsert(table: string, columns: string[], key: string[], rows: (string | number | null)[][]): string {
  const set = columns
    .filter((c) => !key.includes(c))
    .map((c) => `${c} = excluded.${c}`)
    .join(', ')
  const statements: string[] = []
  for (let i = 0; i < rows.length; i += CHUNK) {
    const values = rows.slice(i, i + CHUNK).map(tuple).join(',\n')
    statements.push(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${values}\nON CONFLICT (${key.join(', ')}) DO UPDATE SET ${set};`,
    )
  }
  return statements.join('\n')
}

export const upsertConversation = (c: Conversation): string =>
  upsert('conversations', ['id', 'project', 'title', 'started_at'], ['id'], [[c.id, c.project, c.title, c.startedAt]])

export function upsertRequests(conversationId: string, rs: Request[]): string {
  const columns = [
    'message_id', 'request_id', 'conversation_id', 'agent_id', 'at', 'model', 'is_fast',
    'input', 'cache_write_5m', 'cache_write_1h', 'cache_read', 'output',
    'cost_input', 'cost_cache_write', 'cost_cache_read', 'cost_output', 'tools', 'tool_use_ids',
  ]
  const rows = rs.map((r) => {
    const cost = costOf(r)
    const t = r.tokens
    return [
      r.messageId, r.requestId, conversationId, r.agentId, r.at, r.model, r.isFast ? 1 : 0,
      t.input, t.cacheWrite5m, t.cacheWrite1h, t.cacheRead, t.output,
      cost?.input ?? null, cost?.cacheWrite ?? null, cost?.cacheRead ?? null, cost?.output ?? null,
      JSON.stringify(r.tools), JSON.stringify(r.toolUseIds),
    ]
  })
  return upsert('requests', columns, ['message_id', 'request_id'], rows)
}

export const upsertSubagents = (conversationId: string, ss: Subagent[]): string =>
  upsert(
    'subagents',
    ['agent_id', 'conversation_id', 'parent_agent_id', 'name', 'tool_use_id'],
    ['agent_id'],
    ss.map((s) => [s.agentId, conversationId, s.parentAgentId, s.name, s.toolUseId]),
  )

export const upsertPrompts = (conversationId: string, ps: Prompt[]): string =>
  upsert('prompts', ['conversation_id', 'at', 'text'], ['conversation_id', 'at'], ps.map((p) => [conversationId, p.at, p.text]))

export const upsertWindow = (w: Window): string =>
  upsert('windows', ['kind', 'start', '"end"', 'percent_used'], ['kind', 'start'], [[w.kind, w.start, w.end, w.percentUsed]])

// Column list that sums the usage of the joined `requests` rows (alias r).
const USAGE = `COALESCE(SUM(r.input), 0) AS input,
  COALESCE(SUM(r.cache_write_5m), 0) AS cache_write_5m,
  COALESCE(SUM(r.cache_write_1h), 0) AS cache_write_1h,
  COALESCE(SUM(r.cache_read), 0) AS cache_read,
  COALESCE(SUM(r.output), 0) AS output,
  SUM(r.cost_input) AS cost_input,
  SUM(r.cost_cache_write) AS cost_cache_write,
  SUM(r.cost_cache_read) AS cost_cache_read,
  SUM(r.cost_output) AS cost_output,
  COUNT(r.cost_input) AS cost_count`

export const selectWindows = (): string => `SELECT kind, start, "end", percent_used FROM windows ORDER BY start;`

export const selectWindowTotal = (w: Window): string =>
  `SELECT ${USAGE} FROM requests r WHERE r.at >= ${quote(w.start)} AND r.at < ${quote(w.end)};`

export const selectHistory = (): string =>
  `SELECT c.id, c.project, c.title, c.started_at, COUNT(r.message_id) AS request_count, ${USAGE}
FROM conversations c LEFT JOIN requests r ON r.conversation_id = c.id
GROUP BY c.id ORDER BY c.started_at DESC;`

export const selectSlices = (): string =>
  `SELECT w.kind, w.start AS window_start, r.conversation_id, MIN(r.at) AS first_at, COUNT(*) AS request_count, ${USAGE}
FROM windows w JOIN requests r ON r.at >= w.start AND r.at < w."end"
GROUP BY w.kind, w.start, r.conversation_id;`

// One row per request, each carrying its conversation's columns; one row with NULL request columns
// when the conversation has no request. No row when the conversation is unknown.
export const selectConversation = (id: string): string =>
  `SELECT c.project, c.title, c.started_at, r.*
FROM conversations c LEFT JOIN requests r ON r.conversation_id = c.id
WHERE c.id = ${quote(id)} ORDER BY r.at;`

export const selectSubagents = (id: string): string =>
  `SELECT agent_id, parent_agent_id, name, tool_use_id FROM subagents WHERE conversation_id = ${quote(id)} ORDER BY rowid;`

export const selectPrompts = (id: string): string =>
  `SELECT at, text FROM prompts WHERE conversation_id = ${quote(id)} ORDER BY at;`

const str = (v: unknown): string => String(v ?? '')
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))
const num = (v: unknown): number => Number(v ?? 0)
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
const list = (v: unknown): string[] => {
  const parsed: unknown = JSON.parse(str(v) || '[]')
  return Array.isArray(parsed) ? parsed.map(String) : []
}

export const toWindow = (row: Row): Window => ({
  kind: str(row.kind) as WindowKind,
  start: num(row.start),
  end: num(row.end),
  percentUsed: num(row.percent_used),
})

export function toUsage(row: Row): Usage {
  const tokens = {
    input: num(row.input),
    cacheWrite5m: num(row.cache_write_5m),
    cacheWrite1h: num(row.cache_write_1h),
    cacheRead: num(row.cache_read),
    output: num(row.output),
  }
  if (num(row.cost_count) === 0) return { tokens, cost: null }
  const input = num(row.cost_input)
  const cacheWrite = num(row.cost_cache_write)
  const cacheRead = num(row.cost_cache_read)
  const output = num(row.cost_output)
  return { tokens, cost: { input, cacheWrite, cacheRead, output, total: input + cacheWrite + cacheRead + output } }
}

export const toRequest = (row: Row): Request => ({
  messageId: str(row.message_id),
  requestId: str(row.request_id),
  agentId: strOrNull(row.agent_id),
  at: num(row.at),
  model: str(row.model),
  isFast: num(row.is_fast) === 1,
  tokens: toUsage({ ...row, cost_count: 0 }).tokens,
  tools: list(row.tools),
  toolUseIds: list(row.tool_use_ids),
})

export const toPrompt = (row: Row): Prompt => ({ at: num(row.at), text: str(row.text) })

export const toSubagent = (row: Row): Subagent => ({
  agentId: str(row.agent_id),
  parentAgentId: strOrNull(row.parent_agent_id),
  name: str(row.name),
  toolUseId: strOrNull(row.tool_use_id),
})

export const toHistoryConversation = (row: Row): HistoryConversation => ({
  id: str(row.id),
  project: str(row.project),
  title: str(row.title),
  startedAt: num(row.started_at),
  usage: toUsage(row),
  requestCount: num(row.request_count),
})

export const toSlice = (row: Row): HistorySlice => ({
  kind: str(row.kind) as WindowKind,
  windowStart: num(row.window_start),
  conversationId: str(row.conversation_id),
  usage: toUsage(row),
  requestCount: num(row.request_count),
  firstAt: num(row.first_at),
})
