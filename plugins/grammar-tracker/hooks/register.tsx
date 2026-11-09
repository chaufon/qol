import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GrammarCheck, Occurrence, PaneTab, TopMistakes } from '../types'

// The Python commands to try, in order: `python3` on Linux and macOS, then the `py` launcher and `python` on Windows.
// The first one that starts and is Python 3 runs the scripts; lib/__init__.py reports one older than 3.10.
const PYTHONS: readonly (readonly string[])[] = [['python3'], ['py', '-3'], ['python']]
const PYTHON_PROBE = ['-c', 'import sys; print(sys.version_info[0])']
const NO_PYTHON = 'Grammar tracker needs Python 3.10 or newer as python3, py or python on the PATH'

const PANE = 'grammar'
const ACCENT = 'planMode'
const CHECK_LABEL = '**English grammar check:**'
const NOT_APPLY = 'English grammar check does not apply'
const NOT_APPLY_LINE = 'Grammar check does not apply to the last prompt'
const NO_MISTAKES_LINE = 'No mistakes. Great English, keep it up!'
const NO_CHECK_LINE = 'Grammar: no check for the last prompt'
const BLOCK = /```grammar-json\s*\n[\s\S]*?\n\s*```\s*/
const BLOCK_OPEN = '```grammar-json'
const BLOCK_CLOSED = /^```grammar-json\s*\n[\s\S]*?\n\s*```/
const CHECKING_LINE = 'Grammar: checking…'
const CHECKING_PANE = '⠋ Checking this prompt…'
const TYPE_WIDTH = 15

const last = atom({ plugin: 'grammar-tracker', key: 'last' } as const, null)
const isOpen = atom({ plugin: 'grammar-tracker', key: 'isOpen' } as const, false)
const tab = atom({ plugin: 'grammar-tracker', key: 'tab' } as const, 'last')
const top = atom({ plugin: 'grammar-tracker', key: 'top' } as const, null as TopMistakes)
const openRow = atom({ plugin: 'grammar-tracker', key: 'openRow' } as const, null as string | null)
const pending = atom({ plugin: 'grammar-tracker', key: 'pending' } as const, false)
const manualHide = atom({ plugin: 'grammar-tracker', key: 'manualHide' } as const, false)

type OccurrenceFields = {
  type: string
  type_label: string
  type_description: string
  type_example: string | null
  identifier: string
  original: string
  corrected: string
  reason: string | null
  count: number
  is_recurring: boolean
}

type SaveOutput = {
  systemMessage?: string
  does_not_apply?: true
  corrected_prompt?: string
  occurrences?: OccurrenceFields[]
}

// Removes the grammar check label and its grammar-json block from the start of a reply's first block.
// A grammar-json block that is still streaming hides the whole text until it closes.
export function stripCheck(text: string): string {
  const start = text.trimStart()
  const hasLabel = start.startsWith(CHECK_LABEL)
  const body = hasLabel ? start.slice(CHECK_LABEL.length).trimStart() : start
  if (body.startsWith(NOT_APPLY)) {
    const end = body.indexOf('\n\n')
    return end === -1 ? '' : body.slice(end + 2)
  }
  if (hasLabel) {
    const block = BLOCK.exec(start)
    if (block) return start.slice(block.index + block[0].length)
    if (start.includes(BLOCK_OPEN)) return ''
  }
  return text
}

// What the reply streamed so far says about the check: 'check' once its grammar-json block is closed, 'not-apply' once
// the does-not-apply line is in, 'waiting' while the start of the reply can still become either, and 'unlikely' once
// the reply cannot be a check.
export type CheckState = 'check' | 'not-apply' | 'waiting' | 'unlikely'

export function checkState(text: string): CheckState {
  const start = text.trimStart()
  const body = start.startsWith(CHECK_LABEL) ? start.slice(CHECK_LABEL.length).trimStart() : start
  if (body.startsWith(NOT_APPLY)) return 'not-apply'
  if (body.startsWith(BLOCK_OPEN)) return BLOCK_CLOSED.test(body) ? 'check' : 'waiting'
  return [CHECK_LABEL, NOT_APPLY, BLOCK_OPEN].some(opener => opener.startsWith(body)) ? 'waiting' : 'unlikely'
}

export function toCheck(output: SaveOutput): GrammarCheck | null {
  if (output.does_not_apply) return { doesNotApply: true }
  if (output.occurrences === undefined) return null
  const occurrences = output.occurrences.map(toOccurrence)
  return { doesNotApply: false, correctedPrompt: output.corrected_prompt ?? '', occurrences }
}

function toOccurrence(o: OccurrenceFields): Occurrence {
  return {
    type: o.type,
    typeLabel: o.type_label,
    typeDescription: o.type_description,
    typeExample: o.type_example,
    identifier: o.identifier,
    original: o.original,
    corrected: o.corrected,
    reason: o.reason ?? null,
    count: o.count,
    isRecurring: o.is_recurring,
  }
}

export function bandLine(check: GrammarCheck): string {
  if (check.doesNotApply) return NOT_APPLY_LINE
  const total = check.occurrences.length
  if (total === 0) return NO_MISTAKES_LINE
  const recurring = check.occurrences.filter(o => o.isRecurring).length
  return `Grammar: ${total} mistake${total === 1 ? '' : 's'}, ${recurring} recurring`
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// Cuts a cell to its column width with an ellipsis, or pads it to that width.
export function cell(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width)
}

// The width of the Count column in a Top mistakes row: the header "Count", or the largest count when it is wider.
export function countColumn(largest: number): number {
  return Math.max('Count'.length, String(largest).length)
}

// The width of the Mistake column in a Top mistakes row, so the row fits the pane on one line. The row holds the open
// mark and the rank ("▾  3 "), the type, two spaces, the mistake and the Count column.
export function mistakeColumn(paneWidth: number, largest: number): number {
  return Math.max(8, paneWidth - 5 - TYPE_WIDTH - 2 - countColumn(largest))
}

// The Python command found, kept while the module is loaded. A failed search is not kept, so a Python installed later
// is found on the next run.
let python: Promise<readonly string[]> | undefined

async function findPython($: EngineInterface): Promise<readonly string[]> {
  for (const candidate of PYTHONS) {
    try {
      const ran = await $.process.run([...candidate, ...PYTHON_PROBE], { timeoutMs: 10_000 })
      if (ran.exitCode === 0 && ran.stdout.trim() === '3') return candidate
    } catch {
      // The command does not exist on this machine: try the next one.
    }
  }
  throw new Error(NO_PYTHON)
}

function pythonCommand($: EngineInterface): Promise<readonly string[]> {
  python ??= findPython($).catch(error => {
    python = undefined
    throw error
  })
  return python
}

// Runs one of the plugin's Python scripts and returns its standard output. The script finds the data folder in Claude
// Code's plugins folder (PLUGIN_DATA in scripts/lib/config.py).
async function runScript($: EngineInterface, argv: string[], stdin?: string): Promise<string> {
  const [script, ...args] = argv
  const ran = await $.process.run([...await pythonCommand($), `${$.plugin.root}/scripts/${script}`, ...args],
                                  stdin === undefined ? { timeoutMs: 10_000 } : { stdin, timeoutMs: 10_000 })
  if (ran.exitCode !== 0) throw new Error(ran.stderr.trim() || `exit code ${ran.exitCode}`)
  return ran.stdout
}

async function refreshTop($: EngineInterface) {
  try {
    const fields: OccurrenceFields[] = JSON.parse(await runScript($, ['query.py', 'top']))
    await update($, top, () => ({ mistakes: fields.map(toOccurrence) }))
  } catch (error) {
    const message = `Grammar tracker: failed to read the top mistakes (${String(error)})`
    await update($, top, () => ({ error: message }))
    $.ui.toast(message)
  }
}

// The load of the top mistakes in flight, so a pane drawn again while query.py runs does not start another.
let loadingTop: Promise<void> | undefined

function loadTop($: EngineInterface): Promise<void> {
  loadingTop ??= refreshTop($).finally(() => {
    loadingTop = undefined
  })
  return loadingTop
}

// Whether the pane is up, by the engine's record: a /clear resets the mod's state while the pane stays up.
async function isPaneUp($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === PANE)
}

async function showTab($: EngineInterface, id: PaneTab) {
  await update($, tab, () => id)
  if (id === 'top') await loadTop($)
}

// Opens the pane. The Show button opens it with focus and turns the automatic opening on again. A check that arrives
// opens it without focus, on the Last prompt tab, unless the user hid it by hand.
async function openPane($: EngineInterface, isAutomatic = false) {
  if (!isAutomatic) await update($, manualHide, () => false)
  await update($, isOpen, () => true)
  await $.ui.open({ id: PANE, title: '✎ Grammar', ...(isAutomatic ? {} : { focus: true }), closeOnEscape: true })
  await loadTop($)
}

async function closePane($: EngineInterface) {
  await update($, manualHide, () => true)
  await update($, isOpen, () => false)
  await $.ui.close({ id: PANE })
}

async function openPaneForCheck($: EngineInterface) {
  if (await read($, manualHide) || await isPaneUp($)) return
  await update($, tab, () => 'last')
  await openPane($, true)
}

// The prompt of the turn in progress and what its reply has settled. 'waiting': the reply may still hold a check.
// 'settled': a check, the does-not-apply line or a failure has been handled. 'unlikely': the reply is no check.
type Turn = { id: string, prompt: string, timestamp: string, phase: 'waiting' | 'settled' | 'unlikely', saving?: Promise<void> }

let turn: Turn | undefined
// The prompt the user just submitted, until the turn it starts takes it.
let submitted: { text: string, timestamp: string } | undefined

async function settle($: EngineInterface, check: GrammarCheck | null) {
  await update($, last, () => check)
  await update($, pending, () => false)
}

// Saves the check of the reply with scripts/save_check.py and shows it in the band and the pane.
async function saveCheck($: EngineInterface, current: Turn, reply: string) {
  try {
    const input = { turn_id: current.id, session_id: await $.session.id(), cwd: await $.session.cwd(),
                    prompt: current.prompt, reply, timestamp: current.timestamp }
    const stdout = await runScript($, ['save_check.py'], JSON.stringify(input))
    const output: SaveOutput = stdout.trim() ? JSON.parse(stdout) : {}
    const check = toCheck(output)
    if (check) {
      await settle($, check)
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

export const register: Register = on => {
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      await update($, isOpen, () => false)
      if (e.origin.kind === 'person') await update($, manualHide, () => true)
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (!e.isMeta && !e.command && e.turnId === undefined && e.text.trim()) {
      submitted = { text: e.text, timestamp: new Date(await $.clock.now()).toISOString() }
    }
    return next(e)
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
    const { Box, Button, Text } = $.ui.resolve(e)
    // isOpen redraws the band when the pane opens or closes.
    const shown = (await read($, isOpen)) || (await isPaneUp($))
    return (
      <Box flexDirection="column">
        {await next(e)}
        <Box>
          <Text dimColor>{isPending ? CHECKING_LINE : check === null ? NO_CHECK_LINE : bandLine(check)}   </Text>
          <Button key="toggle" hotkey="g" plain onPress={() => (shown ? closePane($) : openPane($))}>
            {shown ? 'Hide' : 'Show'}
          </Button>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const width = e.props.bodyColumns
    const check = await read($, last)
    const isPending = await read($, pending)
    const current: PaneTab = await read($, tab)
    const tabButton = (id: PaneTab, label: string) => (
      <Button key={`tab-${id}`} plain onPress={() => showTab($, id)}>
        {current === id
          ? <Text bold color="inverseText" backgroundColor={ACCENT}>{` ${label} `}</Text>
          : <Text dimColor>{` ${label} `}</Text>}
      </Button>
    )
    // The keys, on the last row the pane shows, under a line: the pane has no footer of its own, so the two rows move
    // with the scroll.
    const { offset, bodyRows } = e.props.scroll
    const keys: [string, string, string, () => void][] = [
      ['tab-next', 't', 'Tab', () => void showTab($, current === 'last' ? 'top' : 'last')],
      ['hide', 'h', 'Hide', () => void closePane($)],
    ]
    const used = keys.reduce((n, [, hotkey, label]) => n + hotkey.length + label.length + 4, 0)
    const footer = (
      <Box position="absolute" top={offset + bodyRows - 2} left={0} width={width} flexDirection="column">
        <Text dimColor>{'─'.repeat(width)}</Text>
        <Box>
          {keys.map(([key, hotkey, label, press]) => [
            <Button key={key} plain hotkey={hotkey} dimColor onPress={press}>{label}</Button>,
            <Text key={`${key}-gap`}>{'  '}</Text>,
          ])}
          <Text>{' '.repeat(Math.max(0, width - used))}</Text>
        </Box>
      </Box>
    )

    // A bordered card whose title is painted over its top border, cut with an ellipsis where the border is too short.
    const card = (key: string, title: string, cardWidth: number, borderColor: string, body: JSX.Element[]) => (
      <Box key={key} flexDirection="column" width={cardWidth} marginTop={1}>
        <Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={1}>
          {body}
        </Box>
        <Box position="absolute" top={0} left={2} width={Math.min(title.length + 2, cardWidth - 4)}>
          <Text bold color={borderColor} wrap="truncate-end">{` ${title} `}</Text>
        </Box>
      </Box>
    )
    const fitsBorder = (title: string, cardWidth: number) => title.length + 2 <= cardWidth - 4
    const sentences = (o: Occurrence) => [
      <Text key="original" color="error">✗ {o.original}</Text>,
      <Text key="corrected" color="success">✓ {o.corrected}</Text>,
      ...(o.reason ? [<Text key="reason" dimColor>{o.reason}</Text>] : []),
    ]
    const example = (o: Occurrence) => (o.typeExample ? `Example: ${o.typeExample}` : '')

    const lastTab = (check: GrammarCheck & { doesNotApply: false }) => (
      <Box flexDirection="column">
        {check.occurrences.length === 0 ? <Text bold color="success">✓ {NO_MISTAKES_LINE}</Text> : null}
        {check.occurrences.map((o, n) => {
          const title = `${n + 1} · ${capitalize(o.typeLabel)} · "${o.identifier}" ×${o.count}${o.isRecurring ? ' ⟳' : ''}`
          const rule = `${o.typeDescription}${o.typeExample ? ` (${o.typeExample})` : ''}`
          return card(`o${n}`, title, width, o.isRecurring ? 'warning' : 'inactive', [
            ...sentences(o),
            <Text key="rule" dimColor>{rule}</Text>,
          ])
        })}
        {card('corrected', 'Corrected prompt', width, 'suggestion', [<Text key="text">{check.correctedPrompt}</Text>])}
      </Box>
    )

    const topTab = async (mistakes: Occurrence[]) => {
      if (mistakes.length === 0) return <Text dimColor>No mistakes logged yet</Text>
      const open = await read($, openRow)
      const largest = Math.max(...mistakes.map(o => o.count))
      const mistakeWidth = mistakeColumn(width, largest)
      const countWidth = countColumn(largest)
      const cardWidth = width - 2
      const recurring = mistakes.filter(o => o.isRecurring).length
      const total = mistakes.reduce((sum, o) => sum + o.count, 0)
      return (
        <Box flexDirection="column">
          <Text dimColor>{` ${'#'.padStart(3)} ${cell('Type', TYPE_WIDTH)}  ${cell('Mistake', mistakeWidth)}${'Count'.padStart(countWidth)}`}</Text>
          <Text dimColor>{` ${'-'.repeat(3)} ${'-'.repeat(TYPE_WIDTH - 1)}   ${'-'.repeat(mistakeWidth - 1)} ${'-'.repeat(countWidth)}`}</Text>
          {mistakes.map((o, n) => {
            const id = `${o.type}:${o.identifier}`
            const isOpen = open === id
            // Only the open row has a mark; the count is yellow for a recurring mistake.
            const row = (
              <Button key={`row-${n}`} plain onPress={() => update($, openRow, () => (isOpen ? null : id))}>
                {`${isOpen ? '▾' : ' '}${String(n + 1).padStart(3)} ${cell(capitalize(o.typeLabel), TYPE_WIDTH)}  `}
                {cell(o.identifier, mistakeWidth)}
                <Text color={o.isRecurring ? 'warning' : 'success'}>{String(o.count).padStart(countWidth)}</Text>
              </Button>
            )
            if (!isOpen) return row
            const rule = fitsBorder(o.typeDescription, cardWidth) ? example(o) : `${o.typeDescription} ${example(o)}`
            return (
              <Box key={`mistake-${n}`} flexDirection="column">
                {row}
                <Box marginLeft={2} marginBottom={1}>
                  {card('example', o.typeDescription, cardWidth, o.isRecurring ? 'warning' : 'inactive', [
                    ...(rule.trim() ? [<Text key="rule" dimColor>{rule.trim()}</Text>] : []),
                    ...sentences(o),
                  ])}
                </Box>
              </Box>
            )
          })}
          <Text> </Text>
          <Text>{`${recurring} recurring · ${total} mistakes in the top ${mistakes.length}`}</Text>
        </Box>
      )
    }

    const topMistakes = await read($, top)
    return (
      <Box flexDirection="column" width={width} minHeight={bodyRows} paddingBottom={2}>
        <Text dimColor>{'─'.repeat(width)}</Text>
        <Box gap={1}>
          {tabButton('last', 'Last prompt')}
          {tabButton('top', 'Top mistakes')}
        </Box>
        <Text dimColor>{'─'.repeat(width)}</Text>
        {current === 'top' ? (
          topMistakes === null ? (
            <Text dimColor>Loading…</Text>
          ) : 'error' in topMistakes ? (
            <Text color="error">{topMistakes.error}</Text>
          ) : (
            await topTab(topMistakes.mistakes)
          )
        ) : isPending ? (
          <Text color={ACCENT}>{CHECKING_PANE}</Text>
        ) : check === null ? (
          <Text dimColor>No grammar check for the last prompt.</Text>
        ) : check.doesNotApply ? (
          <Text dimColor>{NOT_APPLY_LINE}</Text>
        ) : (
          lastTab(check)
        )}
        {footer}
      </Box>
    )
  })
}
