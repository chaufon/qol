import type {
  Conversation,
  HistoryConversation,
  HistorySlice,
  PriceRow,
  Prompt,
  Rates,
  Request,
  Subagent,
  Usage,
  Window,
  WindowKind,
} from '../types'

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
CREATE TABLE IF NOT EXISTS price_lists (since INTEGER PRIMARY KEY, source TEXT NOT NULL, checked_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS prices (
  since INTEGER NOT NULL, ord INTEGER NOT NULL, model TEXT NOT NULL,
  input REAL NOT NULL, cache_write_5m REAL NOT NULL, cache_write_1h REAL NOT NULL, cache_read REAL NOT NULL, output REAL NOT NULL,
  fast_factor REAL, long_above INTEGER,
  long_input REAL, long_cache_write_5m REAL, long_cache_write_1h REAL, long_cache_read REAL, long_output REAL,
  PRIMARY KEY (since, model));
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
    .filter(c => !key.includes(c))
    .map(c => `${c} = excluded.${c}`)
    .join(', ')
  const statements: string[] = []
  for (let i = 0; i < rows.length; i += CHUNK) {
    const values = rows
      .slice(i, i + CHUNK)
      .map(tuple)
      .join(',\n')
    statements.push(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${values}\nON CONFLICT (${key.join(', ')}) DO UPDATE SET ${set};`,
    )
  }
  return statements.join('\n')
}

export const upsertConversation = (c: Conversation): string =>
  upsert('conversations', ['id', 'project', 'title', 'started_at'], ['id'], [[c.id, c.project, c.title, c.startedAt]])

// The cost columns are left to `repriceRequests`.
export function upsertRequests(conversationId: string, rs: Request[]): string {
  const columns = [
    'message_id',
    'request_id',
    'conversation_id',
    'agent_id',
    'at',
    'model',
    'is_fast',
    'input',
    'cache_write_5m',
    'cache_write_1h',
    'cache_read',
    'output',
    'tools',
    'tool_use_ids',
  ]
  const rows = rs.map(r => {
    const t = r.tokens
    return [
      r.messageId,
      r.requestId,
      conversationId,
      r.agentId,
      r.at,
      r.model,
      r.isFast ? 1 : 0,
      t.input,
      t.cacheWrite5m,
      t.cacheWrite1h,
      t.cacheRead,
      t.output,
      JSON.stringify(r.tools),
      JSON.stringify(r.toolUseIds),
    ]
  })
  return upsert('requests', columns, ['message_id', 'request_id'], rows)
}

const PRICE_COLUMNS = [
  'since',
  'ord',
  'model',
  'input',
  'cache_write_5m',
  'cache_write_1h',
  'cache_read',
  'output',
  'fast_factor',
  'long_above',
  'long_input',
  'long_cache_write_5m',
  'long_cache_write_1h',
  'long_cache_read',
  'long_output',
]

// Stores one price list in place of any list with the same `since`.
export function replacePriceList(since: number, source: string, checkedAt: number, rows: PriceRow[]): string {
  const values = rows.map((r, i) => {
    const l = r.longRates
    return [
      since,
      i,
      r.model,
      r.rates.input,
      r.rates.cacheWrite5m,
      r.rates.cacheWrite1h,
      r.rates.cacheRead,
      r.rates.output,
      r.fastFactor,
      r.longAbove,
      l?.input ?? null,
      l?.cacheWrite5m ?? null,
      l?.cacheWrite1h ?? null,
      l?.cacheRead ?? null,
      l?.output ?? null,
    ]
  })
  return [
    `DELETE FROM prices WHERE since = ${quote(since)};`,
    upsert('price_lists', ['since', 'source', 'checked_at'], ['since'], [[since, source, checkedAt]]),
    upsert('prices', PRICE_COLUMNS, ['since', 'model'], values),
  ]
    .filter(s => s !== '')
    .join('\n')
}

export const touchPriceList = (since: number, checkedAt: number): string =>
  `UPDATE price_lists SET checked_at = ${quote(checkedAt)} WHERE since = ${quote(since)};`

export const selectPrices = (): string => `SELECT ${PRICE_COLUMNS.join(', ')} FROM prices ORDER BY since, ord;`

export const selectPriceLists = (): string => `SELECT since, source, checked_at FROM price_lists ORDER BY since;`

// The ids that price under `p.model` (priceKey in prices.ts): the id itself, then with a trailing date,
// each with or without a trailing `[...]` tag.
const MATCHES_MODEL = (() => {
  const date = '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
  const forms = ['', `-${date}`, `@${date}`].flatMap(d => [d, `${d}[[]*]`])
  return `(r.model = p.model OR ${forms
    .slice(1)
    .map(f => `r.model GLOB p.model || '${f}'`)
    .join(' OR ')})`
})()

// Sets the cost columns of the stored requests (of one conversation, or all when null) from the prices table,
// by the rule of costOf in prices.ts: the newest row of the model in effect when the request ran, else its
// oldest row; NULL when no row names the model.
export function repriceRequests(conversationId: string | null): string {
  const scope = conversationId === null ? '' : `WHERE r.conversation_id = ${quote(conversationId)}`
  return `WITH candidate AS (
  SELECT r.message_id, r.request_id, p.rowid AS price_id,
    ROW_NUMBER() OVER (PARTITION BY r.message_id, r.request_id ORDER BY p.since > r.at, IIF(p.since <= r.at, -p.since, p.since)) AS n
  FROM requests r JOIN prices p ON ${MATCHES_MODEL} ${scope}
), pick AS (
  SELECT r.message_id, r.request_id, r.is_fast, r.input + r.cache_write_5m + r.cache_write_1h + r.cache_read AS prompt, c.price_id
  FROM requests r LEFT JOIN candidate c ON c.message_id = r.message_id AND c.request_id = r.request_id AND c.n = 1 ${scope}
), x AS (
  SELECT pick.message_id, pick.request_id, p.*,
    IIF(pick.is_fast = 1 AND p.fast_factor IS NOT NULL, p.fast_factor, 1) / 1000000.0 AS factor,
    (p.long_above IS NOT NULL AND p.long_input IS NOT NULL AND pick.prompt > p.long_above) AS is_long
  FROM pick LEFT JOIN prices p ON p.rowid = pick.price_id
)
UPDATE requests SET
  cost_input = requests.input * IIF(x.is_long, x.long_input, x.input) * x.factor,
  cost_cache_write = (requests.cache_write_5m * IIF(x.is_long, x.long_cache_write_5m, x.cache_write_5m)
    + requests.cache_write_1h * IIF(x.is_long, x.long_cache_write_1h, x.cache_write_1h)) * x.factor,
  cost_cache_read = requests.cache_read * IIF(x.is_long, x.long_cache_read, x.cache_read) * x.factor,
  cost_output = requests.output * IIF(x.is_long, x.long_output, x.output) * x.factor
FROM x WHERE requests.message_id = x.message_id AND requests.request_id = x.request_id;`
}

export const upsertSubagents = (conversationId: string, ss: Subagent[]): string =>
  upsert(
    'subagents',
    ['agent_id', 'conversation_id', 'parent_agent_id', 'name', 'tool_use_id'],
    ['agent_id'],
    ss.map(s => [s.agentId, conversationId, s.parentAgentId, s.name, s.toolUseId]),
  )

export const upsertPrompts = (conversationId: string, ps: Prompt[]): string =>
  upsert(
    'prompts',
    ['conversation_id', 'at', 'text'],
    ['conversation_id', 'at'],
    ps.map(p => [conversationId, p.at, p.text]),
  )

export const upsertWindow = (w: Window): string =>
  upsert(
    'windows',
    ['kind', 'start', '"end"', 'percent_used'],
    ['kind', 'start'],
    [[w.kind, w.start, w.end, w.percentUsed]],
  )

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

// sqlite3 -json gives each cell as a string, a number or null.
const text = (v: unknown): string | null =>
  typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : null
const str = (v: unknown): string => text(v) ?? ''
const strOrNull = (v: unknown): string | null => text(v)
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

const rates = (row: Row, prefix: string): Rates => ({
  input: num(row[`${prefix}input`]),
  cacheWrite5m: num(row[`${prefix}cache_write_5m`]),
  cacheWrite1h: num(row[`${prefix}cache_write_1h`]),
  cacheRead: num(row[`${prefix}cache_read`]),
  output: num(row[`${prefix}output`]),
})

export const toPriceRow = (row: Row): PriceRow => ({
  since: num(row.since),
  model: str(row.model),
  rates: rates(row, ''),
  fastFactor: numOrNull(row.fast_factor),
  longAbove: numOrNull(row.long_above),
  longRates: row.long_input === null || row.long_input === undefined ? null : rates(row, 'long_'),
})

export const toPriceList = (row: Row): { since: number; source: string; checkedAt: number } => ({
  since: num(row.since),
  source: str(row.source),
  checkedAt: num(row.checked_at),
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
