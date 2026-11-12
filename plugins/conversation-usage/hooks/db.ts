import type { EngineInterface } from 'claude-code'

import type { Conversation, HistoryData, PriceBook, PriceRow, Usage, Window } from '../types'
import { BUILT_IN, BUILT_IN_BOOK, BUILT_IN_CHECKED_AT, samePrices } from './prices'
import { configDir } from './sync'
import {
  repriceRequests,
  replacePriceList,
  SCHEMA,
  selectConversation,
  selectHistory,
  selectPriceLists,
  selectPrices,
  selectPrompts,
  selectSlices,
  selectSubagents,
  selectWindows,
  selectWindowTotal,
  toHistoryConversation,
  toPriceList,
  toPriceRow,
  toPrompt,
  toRequest,
  toSlice,
  toSubagent,
  toUsage,
  toWindow,
  touchPriceList,
  upsertConversation,
  upsertPrompts,
  upsertRequests,
  upsertSubagents,
  upsertWindow,
} from './sql'

export interface Db {
  path: string
}

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
    await run(
      $,
      db,
      transaction([replacePriceList(0, 'built-in', BUILT_IN_CHECKED_AT, BUILT_IN), repriceRequests(null)]),
    )
  } catch (error) {
    // A rejected call that is not a timeout means sqlite3 cannot start; every other failure keeps its own first line.
    const message = error instanceof Error ? error.message : String(error)
    return {
      error: error instanceof SpawnError && !RAN_TOO_LONG.test(message) ? MISSING : (message.split('\n')[0] ?? message),
    }
  }
  return db
}

export async function exec($: EngineInterface, db: Db, sql: string): Promise<void> {
  await run($, db, sql)
}

export async function query<T>(
  $: EngineInterface,
  db: Db,
  sql: string,
  map: (row: Record<string, unknown>) => T,
): Promise<T[]> {
  return (await run($, db, sql)).map(map)
}

const transaction = (statements: string[]): string => `BEGIN;\n${statements.filter(s => s !== '').join('\n')}\nCOMMIT;`

export async function saveConversation($: EngineInterface, db: Db, c: Conversation): Promise<void> {
  await exec(
    $,
    db,
    transaction([
      upsertConversation(c),
      upsertSubagents(c.id, c.subagents),
      upsertRequests(c.id, c.requests),
      upsertPrompts(c.id, c.prompts),
      repriceRequests(c.id),
    ]),
  )
}

// Every stored price row, and the newest price list; the built-in prices when none is stored.
export async function loadPriceBook($: EngineInterface, db: Db): Promise<PriceBook> {
  const [rows, lists] = await Promise.all([
    query($, db, selectPrices(), toPriceRow),
    query($, db, selectPriceLists(), toPriceList),
  ])
  if (rows.length === 0) return BUILT_IN_BOOK
  const newest = lists[lists.length - 1]
  return {
    rows,
    source: newest === undefined || newest.source === 'built-in' ? 'built-in' : 'downloaded',
    since: newest?.since ?? 0,
    checkedAt: newest?.checkedAt ?? BUILT_IN_CHECKED_AT,
    error: null,
  }
}

// Stores downloaded prices checked at `now`. Prices equal to the newest downloaded list only confirm it;
// other prices start a new list in effect from `now`, and every stored request is priced again.
export async function saveDownloadedPrices(
  $: EngineInterface,
  db: Db,
  rows: PriceRow[],
  now: number,
): Promise<'confirmed' | 'changed'> {
  const lists = await query($, db, selectPriceLists(), toPriceList)
  const newest = lists.filter(l => l.source === 'downloaded').pop()
  if (newest !== undefined) {
    const stored = (await query($, db, selectPrices(), toPriceRow)).filter(r => r.since === newest.since)
    if (samePrices(stored, rows)) {
      await exec($, db, touchPriceList(newest.since, now))
      return 'confirmed'
    }
  }
  await exec($, db, transaction([replacePriceList(now, 'downloaded', now, rows), repriceRequests(null)]))
  return 'changed'
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
  const rows = await query($, db, selectConversation(id), row => row)
  const first = rows[0]
  if (first === undefined) return null
  const [subagents, prompts] = await Promise.all([
    query($, db, selectSubagents(id), toSubagent),
    query($, db, selectPrompts(id), toPrompt),
  ])
  return {
    id,
    project: String(first.project),
    title: String(first.title),
    startedAt: Number(first.started_at),
    requests: rows.filter(row => row.message_id !== null && row.message_id !== undefined).map(toRequest),
    subagents,
    prompts,
  }
}
