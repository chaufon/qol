import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Grouping, Tab, View, WindowTotal } from '../types'
import {
  loadConversation,
  loadHistory,
  loadPriceBook,
  loadWindows,
  loadWindowTotal,
  openDb,
  saveConversation,
  saveDownloadedPrices,
  saveWindow,
} from './db'
import type { Db } from './db'
import { drawPane } from './draw'
import type { Actions } from './draw'
import { fmtCost, fmtTokens } from './format'
import { sumUsage } from './model'
import { BUILT_IN_BOOK, PRICING_URL, totalTokens, usePriceBook } from './prices'
import { parsePricingPage } from './pricing-page'
import { newReader, readConversation } from './sync'
import { currentWindows, observe } from './windows'

const PANE = 'conversation-usage'
const VIEWS: View[] = ['tokens', 'cost', 'both', 'chart']
const GROUPINGS: Grouping[] = ['date', 'project', 'window']
const TABS: Tab[] = ['conversation', 'history', 'prices']

const isOpen = atom({ plugin: 'conversation-usage', key: 'isOpen' } as const, false)
const tab = atom({ plugin: 'conversation-usage', key: 'tab' } as const, 'conversation')
const view = atom({ plugin: 'conversation-usage', key: 'view' } as const, 'tokens')
const grouping = atom({ plugin: 'conversation-usage', key: 'grouping' } as const, 'date')
const expanded = atom({ plugin: 'conversation-usage', key: 'expanded' } as const, {})
const current = atom({ plugin: 'conversation-usage', key: 'current' } as const, null)
const windowTotals = atom({ plugin: 'conversation-usage', key: 'windowTotals' } as const, [])
const history = atom({ plugin: 'conversation-usage', key: 'history' } as const, null)
const details = atom({ plugin: 'conversation-usage', key: 'details' } as const, {})
const notice = atom({ plugin: 'conversation-usage', key: 'notice' } as const, null)
const now = atom({ plugin: 'conversation-usage', key: 'now' } as const, 0)
const prices = atom({ plugin: 'conversation-usage', key: 'prices' } as const, BUILT_IN_BOOK)
const priceAttemptAt = atom({ plugin: 'conversation-usage', key: 'priceAttemptAt' } as const, null)

// A downloaded price list is checked again once it is this old; a failed download is tried again after RETRY_MS.
const CHECK_EVERY_MS = 24 * 3_600_000
const RETRY_MS = 3_600_000

const after = <T,>(list: T[], item: T): T => list[(list.indexOf(item) + 1) % list.length] ?? item

// One line for the notice: the first line of the error.
const oneLine = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  return message.split('\n')[0] ?? message
}

// The transcript reader, and the database once it has opened. A failed open is retried on the next call.
const reader = newReader()
let opened: Db | undefined

async function database($: EngineInterface): Promise<Db | { error: string }> {
  if (opened !== undefined) return opened
  const result = await openDb($)
  if (!('error' in result)) opened = result
  return result
}

async function loadHistoryAtom($: EngineInterface): Promise<void> {
  const db = await database($)
  try {
    const next = 'error' in db ? { error: db.error } : await loadHistory($, db)
    await update($, history, () => next)
  } catch (error) {
    await update($, history, () => ({ error: oneLine(error) }))
  }
}

async function loadDetailsAtom($: EngineInterface, id: string): Promise<void> {
  const db = await database($)
  if ('error' in db) return
  try {
    const found = await loadConversation($, db, id)
    if (found !== null) await update($, details, m => ({ ...m, [id]: found }))
  } catch (error) {
    await update($, notice, () => oneLine(error))
  }
}

// Puts the stored prices in use, keeping the last download error.
async function loadPrices($: EngineInterface, db: Db): Promise<void> {
  const book = await loadPriceBook($, db)
  const { error } = await read($, prices)
  usePriceBook(book)
  await update($, prices, () => ({ ...book, error }))
}

// Downloads the pricing page when the newest downloaded list is a day old or there is none, at most once an
// hour. Skipped while CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is set. Never rejects.
async function downloadPrices($: EngineInterface, db: Db, t: number): Promise<void> {
  const book = await read($, prices)
  if (book.source === 'downloaded' && t - book.checkedAt < CHECK_EVERY_MS) return
  const attempt = await read($, priceAttemptAt)
  if (attempt !== null && t - attempt < RETRY_MS) return
  if (await $.env.get('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC')) return
  await update($, priceAttemptAt, () => t)
  let error: string | null = null
  try {
    const response = await $.http.fetch(PRICING_URL)
    const parsed = response.ok
      ? parsePricingPage(response.text, t)
      : { error: `The pricing page answered ${response.status}` }
    if ('error' in parsed) error = parsed.error
    else await saveDownloadedPrices($, db, parsed, t)
  } catch (e) {
    error = oneLine(e)
  }
  await update($, prices, b => ({ ...b, error }))
  await loadPrices($, db)
}

// Reads the conversation, stores it, and totals the live windows. Never rejects.
async function refresh($: EngineInterface): Promise<void> {
  try {
    const id = await $.session.id()
    const t = await $.clock.now()
    const conversation = await readConversation($, reader, id)
    await update($, current, () => conversation)
    // An expanded History conversation that is the current one shows the fresh read.
    if (conversation !== null) {
      await update($, details, m => (conversation.id in m ? { ...m, [conversation.id]: conversation } : m))
    }
    await update($, now, () => t)
    const db = await database($)
    if ('error' in db) {
      await update($, notice, () => db.error)
      return
    }
    await loadPrices($, db)
    if (conversation !== null) await saveConversation($, db, conversation)
    // Before the totals, so prices that changed reach them.
    await downloadPrices($, db, t)
    const totals: WindowTotal[] = []
    for (const window of currentWindows(await loadWindows($, db), t)) {
      totals.push({ window, usage: await loadWindowTotal($, db, window) })
    }
    await update($, windowTotals, () => totals)
    await update($, notice, () => null)
    if ((await read($, isOpen)) && (await read($, tab)) === 'history') await loadHistoryAtom($)
  } catch (error) {
    await update($, notice, () => oneLine(error))
  }
}

// One refresh runs at a time; one more waits behind it, however many are asked for.
let running: Promise<void> | undefined
let queued: Promise<void> | undefined

function start($: EngineInterface): Promise<void> {
  const run: Promise<void> = refresh($).finally(() => {
    if (running === run) running = undefined
  })
  running = run
  return run
}

function queueRefresh($: EngineInterface): Promise<void> {
  if (running === undefined) return start($)
  queued ??= running.then(() => {
    queued = undefined
    return start($)
  })
  return queued
}

async function saveReadings($: EngineInterface, readings: { kind: string; percentUsed: number; resetsAt?: string }[]) {
  const db = await database($)
  if ('error' in db || readings.length === 0) return
  try {
    const t = await $.clock.now()
    for (const reading of readings) {
      for (const window of observe(await loadWindows($, db), reading, t)) await saveWindow($, db, window)
    }
  } catch (error) {
    await update($, notice, () => oneLine(error))
  }
}

async function openPane($: EngineInterface): Promise<void> {
  await update($, isOpen, () => true)
  await $.ui.open({ id: PANE, title: '◔ Usage', focus: true, closeOnEscape: true })
  if ((await read($, history)) === null) await loadHistoryAtom($)
  void queueRefresh($)
}

async function closePane($: EngineInterface): Promise<void> {
  await update($, isOpen, () => false)
  await $.ui.close({ id: PANE })
}

async function togglePane($: EngineInterface): Promise<void> {
  return (await read($, isOpen)) ? closePane($) : openPane($)
}

// Switching to History loads it.
async function showTab($: EngineInterface, t: Tab): Promise<void> {
  await update($, tab, () => t)
  if (t === 'history') await loadHistoryAtom($)
}

function actionsFor($: EngineInterface): Actions {
  return {
    toggle: (key, open) => void update($, expanded, m => ({ ...m, [key]: !open })),
    nextView: () => void update($, view, v => after(VIEWS, v)),
    nextTab: () => void read($, tab).then(t => showTab($, after(TABS, t))),
    nextGrouping: () => void update($, grouping, g => after(GROUPINGS, g)),
    selectTab: t => void showTab($, t),
    selectView: v => void update($, view, () => v),
    selectGrouping: g => void update($, grouping, () => g),
    hide: () => void closePane($),
    loadDetails: id => void loadDetailsAtom($, id),
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'conversation-usage', description: 'Open or close the usage pane' })
    void queueRefresh($)
    return result
  })

  on('session.measure', async ($, e, next) => {
    await saveReadings($, e.rateLimits)
    const result = await next(e)
    void queueRefresh($)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    void queueRefresh($)
    return result
  })

  on('command.run', { command: 'conversation-usage' }, async $ => {
    await togglePane($)
    return { text: '' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await update($, isOpen, () => false)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const conversation = await read($, current)
    const shown = await read($, isOpen)
    const requests = conversation?.requests ?? []
    const usage = sumUsage(requests)
    const total = totalTokens(usage.tokens)
    const line =
      requests.length === 0
        ? 'Usage · no requests yet'
        : `Usage · ${fmtTokens(total)} tokens · ${fmtCost(usage.cost?.total ?? null)}`
    return (
      <Box flexDirection="column">
        {await next(e)}
        <Box>
          <Text dimColor>{line} </Text>
          <Button key="conversation-usage-toggle" hotkey="u" plain onPress={() => togglePane($)}>
            {shown ? 'Hide' : 'Show'}
          </Button>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    return drawPane(
      $.ui.resolve(e),
      {
        width: e.props.bodyColumns,
        tab: await read($, tab),
        view: await read($, view),
        grouping: await read($, grouping),
        current: await read($, current),
        windowTotals: await read($, windowTotals),
        history: await read($, history),
        details: await read($, details),
        expanded: await read($, expanded),
        notice: await read($, notice),
        now: await read($, now),
        prices: await read($, prices),
        isFullscreen: e.viewport?.isFullscreen === true,
        scroll: e.props.scroll,
      },
      actionsFor($),
    )
  })
}
