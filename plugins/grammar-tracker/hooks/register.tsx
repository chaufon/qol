import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GrammarCheck, PaneTab, TopMistakes } from '../types'
import { checkState, stripCheck, toCheck, toOccurrence } from './check'
import type { ContextOutput, OccurrenceFields, SaveOutput } from './check'
import { drawBand, drawPane } from './draw'
import type { PaneActions } from './draw'
import { runScript } from './python'

const PANE = 'grammar'
const TREND_PROMPTS = 10

const last = atom({ plugin: 'grammar-tracker', key: 'last' } as const, null)
const isOpen = atom({ plugin: 'grammar-tracker', key: 'isOpen' } as const, false)
const tab = atom({ plugin: 'grammar-tracker', key: 'tab' } as const, 'last')
const top = atom({ plugin: 'grammar-tracker', key: 'top' } as const, null as TopMistakes)
const openRow = atom({ plugin: 'grammar-tracker', key: 'openRow' } as const, null as string | null)
const pending = atom({ plugin: 'grammar-tracker', key: 'pending' } as const, false)
const trend = atom({ plugin: 'grammar-tracker', key: 'trend' } as const, null as number[] | null)
const manualHide = atom({ plugin: 'grammar-tracker', key: 'manualHide' } as const, false)

/**
 * The prompt of the turn in progress and what its reply has settled. 'waiting': the reply may still hold a check.
 * 'settled': a check, the does-not-apply line or a failure has been handled. 'unlikely': the reply is no check.
 */
interface Turn {
  id: string
  prompt: string
  timestamp: string
  phase: 'waiting' | 'settled' | 'unlikely'
  saving?: Promise<void>
}

let turn: Turn | undefined
/** The prompt the user just submitted, until the turn it starts takes it. */
let submitted: { text: string; timestamp: string } | undefined
/** The autoOpenPane option: false keeps the pane closed until the user opens it. */
let isAutoOpenOn = true
/** The native_language option, passed to scripts/prompt_context.py, which checks it and names it in the instruction. */
let nativeLanguage: string | undefined
/** The load of the top mistakes in flight, so a pane drawn again while query.py runs does not start another. */
let loadingTop: Promise<void> | undefined

function parseJson<T>(stdout: string, empty: T): T {
  return stdout.trim() ? (JSON.parse(stdout) as T) : empty
}

async function refreshTop($: EngineInterface): Promise<void> {
  try {
    const fields = JSON.parse(await runScript($, 'query.py', ['top'])) as OccurrenceFields[]
    await update($, top, () => ({ mistakes: fields.map(toOccurrence) }))
  } catch (error) {
    const message = `Grammar tracker: failed to read the top mistakes (${String(error)})`
    await update($, top, () => ({ error: message }))
    $.ui.toast(message)
  }
}

async function refreshTrend($: EngineInterface): Promise<void> {
  try {
    const args = ['trend', await $.session.id(), String(TREND_PROMPTS)]
    const counts = JSON.parse(await runScript($, 'query.py', args)) as number[]
    await update($, trend, () => counts)
  } catch (error) {
    await update($, trend, () => null)
    $.ui.toast(`Grammar tracker: failed to read the trend (${String(error)})`)
  }
}

function loadTop($: EngineInterface): Promise<void> {
  loadingTop ??= refreshTop($).finally(() => {
    loadingTop = undefined
  })
  return loadingTop
}

/** Whether the pane is up, by the engine's record: a /clear resets the mod's state while the pane stays up. */
async function isPaneUp($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === PANE)
}

async function showTab($: EngineInterface, id: PaneTab): Promise<void> {
  await update($, tab, () => id)
  if (id === 'top') await loadTop($)
}

/**
 * Opens the pane. The Show button opens it with focus and turns the automatic opening on again. A check that arrives
 * opens it without focus, on the Last prompt tab, unless the user hid it by hand or turned autoOpenPane off.
 */
async function openPane($: EngineInterface, isAutomatic = false): Promise<void> {
  if (!isAutomatic) await update($, manualHide, () => false)
  await update($, isOpen, () => true)
  await $.ui.open({ id: PANE, title: '✎ Grammar', ...(isAutomatic ? {} : { focus: true }), closeOnEscape: true })
  // A check that opens the pane has just refreshed the trend.
  await Promise.all([loadTop($), ...(isAutomatic ? [] : [refreshTrend($)])])
}

async function closePane($: EngineInterface): Promise<void> {
  await update($, manualHide, () => true)
  await update($, isOpen, () => false)
  await $.ui.close({ id: PANE })
}

async function openPaneForCheck($: EngineInterface): Promise<void> {
  if (!isAutoOpenOn || (await read($, manualHide)) || (await isPaneUp($))) return
  await update($, tab, () => 'last')
  await openPane($, true)
}

async function settle($: EngineInterface, check: GrammarCheck | null): Promise<void> {
  await update($, last, () => check)
  await update($, pending, () => false)
}

/** The grammar check instruction for a prompt, from scripts/prompt_context.py; undefined for a prompt that skips it. */
async function promptContext($: EngineInterface, prompt: string): Promise<string | undefined> {
  try {
    const input = JSON.stringify({ prompt, native_language: nativeLanguage })
    const output = parseJson<ContextOutput>(await runScript($, 'prompt_context.py', [], input), {})
    if (output.systemMessage) $.ui.toast(output.systemMessage)
    return output.context
  } catch (error) {
    $.ui.toast(`Grammar tracker: failed to add the grammar check (${String(error)})`)
    return undefined
  }
}

/** Saves the check of the reply with scripts/save_check.py and shows it in the band and the pane. */
async function saveCheck($: EngineInterface, current: Turn, reply: string): Promise<void> {
  try {
    const input = {
      turn_id: current.id,
      session_id: await $.session.id(),
      cwd: await $.session.cwd(),
      prompt: current.prompt,
      reply,
      timestamp: current.timestamp,
    }
    const output = parseJson<SaveOutput>(await runScript($, 'save_check.py', [], JSON.stringify(input)), {})
    const check = toCheck(output)
    if (check) {
      await settle($, check)
      if (!check.doesNotApply) await refreshTrend($)
      if (!check.doesNotApply && check.occurrences.length > 0) await openPaneForCheck($)
    } else {
      await update($, pending, () => false)
      if (output.systemMessage) {
        await update($, last, () => null)
        $.ui.toast(output.systemMessage)
      }
    }
  } catch (error) {
    await settle($, null)
    $.ui.toast(`Grammar tracker: failed to read the check (${String(error)})`)
  }
}

function paneActions($: EngineInterface, row: string | null): PaneActions {
  return {
    showTab: id => showTab($, id),
    hide: () => closePane($),
    toggleRow: async id => {
      await update($, openRow, () => (row === id ? null : id))
    },
  }
}

export const register: Register = (on, options) => {
  isAutoOpenOn = options.autoOpenPane !== false
  nativeLanguage = typeof options.native_language === 'string' ? options.native_language : undefined

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      await update($, isOpen, () => false)
      if (e.origin.kind === 'person') await update($, manualHide, () => true)
    }
    return next(e)
  })

  // A prompt the user typed gets the grammar check instruction beside it, for the model alone, and is kept for the
  // turn it starts. A failure shows a toast and lets the prompt through without the instruction.
  on('prompt.submit', async ($, e, next) => {
    if (e.isMeta || e.command || e.turnId !== undefined || !e.text.trim()) return next(e)
    submitted = { text: e.text, timestamp: new Date(await $.clock.now()).toISOString() }
    const context = await promptContext($, e.text)
    return next(context ? { ...e, context: [...(e.context ?? []), context] } : e)
  })

  // A main-loop turn that starts with a submitted prompt waits for its check: the band and the pane say so.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const prompt = submitted
      submitted = undefined
      turn = prompt ? { id: e.turnId, prompt: prompt.text, timestamp: prompt.timestamp, phase: 'waiting' } : undefined
      if (turn) await update($, pending, () => true)
    }
    return next(e)
  })

  // Watches the streamed reply of the main loop and passes every chunk on unchanged. The check is saved when its
  // grammar-json block closes, and shown when the does-not-apply line is in, while the rest of the reply streams.
  on('turn.step', async function* ($, e, next) {
    const current = turn
    if (e.agentId !== undefined || current?.id !== e.turnId || current.phase !== 'waiting') return yield* next(e)
    let text = ''
    const stream = next(e)
    for await (const chunk of stream) {
      yield chunk
      if (chunk.kind !== 'text' || current.phase !== 'waiting') continue
      text += chunk.text
      const state = checkState(text)
      if (state === 'check') {
        current.phase = 'settled'
        current.saving = saveCheck($, current, text)
      } else if (state === 'not-apply') {
        current.phase = 'settled'
        await settle($, { doesNotApply: true })
      } else if (state === 'unlikely') {
        current.phase = 'unlikely'
      }
    }
    await current.saving
    return await stream.result
  })

  // At the end of each main-loop turn, a turn whose check did not arrive (interrupted reply, no block) leaves the band
  // with no check, so the band and pane never show the check of an older prompt. The Top mistakes tab is refreshed.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const current = turn
    if (e.agentId !== undefined || current?.id !== e.turnId) return result
    turn = undefined
    await current.saving
    if (current.phase !== 'settled') await settle($, null)
    if (await isPaneUp($)) await refreshTop($)
    return result
  })

  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    if (!e.props.isFirstOfReply) return next(e)
    const text = stripCheck(e.props.text)
    return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text } })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const check = await read($, last)
    const isPending = await read($, pending)
    if (e.props.hasSurvey) return next(e)
    // isOpen redraws the band when the pane opens or closes.
    const isShown = (await read($, isOpen)) || (await isPaneUp($))
    const toggle = () => (isShown ? closePane($) : openPane($))
    return drawBand($.ui.resolve(e), { check, isPending, isShown, above: await next(e) }, toggle)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const row = await read($, openRow)
    const props = {
      width: e.props.bodyColumns,
      scroll: e.props.scroll,
      tab: await read($, tab),
      check: await read($, last),
      isPending: await read($, pending),
      top: await read($, top),
      trend: await read($, trend),
      openRow: row,
    }
    return drawPane($.ui.resolve(e), props, paneActions($, row))
  })
}
