import type { EngineInterface } from 'claude-code'

import type { Conversation, HistoryData, Usage, Window } from '../types'
import { configDir } from './sync'
import {
  SCHEMA, selectConversation, selectHistory, selectSlices, selectSubagents, selectWindows, selectWindowTotal,
  toHistoryConversation, toRequest, toSlice, toSubagent, toUsage, toWindow,
  upsertConversation, upsertRequests, upsertSubagents, upsertWindow,
} from './sql'

export type Db = { path: string }

const MISSING = 'Usage history needs sqlite3 on the PATH'

// Busy timeout, and stop at the first failing statement so an open transaction rolls back.
const PREFIX = '.timeout 5000\n.bail on\n'

// sqlite3 started and failed, or its result could not be used.
class SqliteError extends Error {}

// The call to run sqlite3 rejected: it could not start, or it ran past the timeout.
class SpawnError extends Error {}

const RAN_TOO_LONG = /time(d)? ?out/i

// Runs `sql` in sqlite3 and returns the rows it prints; none for an empty result.
async function run($: EngineInterface, db: Db, sql: string): Promise<Record<string, unknown>[]> {
  const result = await $.process
    .run(['sqlite3', '-json', db.path], { stdin: `${PREFIX}${sql}`, timeoutMs: 20_000 })
    .catch((error: unknown) => {
      throw new SpawnError(error instanceof Error ? error.message : String(error))
    })
  if (result.isStdoutTruncated) throw new SqliteError('Usage history result is too large')
  if (result.exitCode !== 0) throw new SqliteError(result.stderr.trim() || `sqlite3 exited with ${result.exitCode}`)
  const text = result.stdout.trim()
  return text === '' ? [] : (JSON.parse(text) as Record<string, unknown>[])
}

export async function openDb($: EngineInterface): Promise<Db | { error: string }> {
  const db = { path: `${await configDir($)}/conversation-usage.db` }
  try {
    await run($, db, SCHEMA)
  } catch (error) {
    // A rejected call that is not a timeout means sqlite3 cannot start; every other failure keeps its own first line.
    const message = error instanceof Error ? error.message : String(error)
    return { error: error instanceof SpawnError && !RAN_TOO_LONG.test(message) ? MISSING : message.split('\n')[0]! }
  }
  return db
}

export async function exec($: EngineInterface, db: Db, sql: string): Promise<void> {
  await run($, db, sql)
}

export async function query<T>($: EngineInterface, db: Db, sql: string, map: (row: Record<string, unknown>) => T): Promise<T[]> {
  return (await run($, db, sql)).map(map)
}

export async function saveConversation($: EngineInterface, db: Db, c: Conversation): Promise<void> {
  const statements = [upsertConversation(c), upsertSubagents(c.id, c.subagents), upsertRequests(c.id, c.requests)]
  await exec($, db, `BEGIN;\n${statements.filter((s) => s !== '').join('\n')}\nCOMMIT;`)
}

export async function saveWindow($: EngineInterface, db: Db, w: Window): Promise<void> {
  await exec($, db, upsertWindow(w))
}

export async function loadWindows($: EngineInterface, db: Db): Promise<Window[]> {
  return query($, db, selectWindows(), toWindow)
}

export async function loadWindowTotal($: EngineInterface, db: Db, w: Window): Promise<Usage> {
  const rows = await query($, db, selectWindowTotal(w), toUsage)
  return rows[0] ?? toUsage({})
}

export async function loadHistory($: EngineInterface, db: Db): Promise<HistoryData> {
  const [conversations, windows, slices] = await Promise.all([
    query($, db, selectHistory(), toHistoryConversation),
    loadWindows($, db),
    query($, db, selectSlices(), toSlice),
  ])
  return { conversations, windows, slices }
}

export async function loadConversation($: EngineInterface, db: Db, id: string): Promise<Conversation | null> {
  const rows = await query($, db, selectConversation(id), (row) => row)
  const first = rows[0]
  if (first === undefined) return null
  const subagents = await query($, db, selectSubagents(id), toSubagent)
  return {
    id,
    project: String(first.project),
    title: String(first.title),
    startedAt: Number(first.started_at),
    requests: rows.filter((row) => row.message_id !== null && row.message_id !== undefined).map(toRequest),
    subagents,
  }
}
