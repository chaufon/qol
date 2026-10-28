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
const NO_CHECK_LINE = 'Grammar: no check for the last prompt'
const BLOCK = /```grammar-json\s*\n[\s\S]*?\n\s*```\s*/
const BLOCK_OPEN = '```grammar-json'
const BAR_WIDTH = 8
const TYPE_WIDTH = 15

const last = atom({ plugin: 'grammar-tracker', key: 'last' } as const, null)
const isOpen = atom({ plugin: 'grammar-tracker', key: 'isOpen' } as const, false)
const tab = atom({ plugin: 'grammar-tracker', key: 'tab' } as const, 'last')
const top = atom({ plugin: 'grammar-tracker', key: 'top' } as const, null as TopMistakes)
const openRow = atom({ plugin: 'grammar-tracker', key: 'openRow' } as const, null as string | null)

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

type StopHookOutput = {
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

export function toCheck(output: StopHookOutput): GrammarCheck | null {
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
  if (total === 0) return 'Grammar: no mistakes'
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

// A bar of up to BAR_WIDTH blocks, as long against the largest count as the count is.
export function bar(count: number, largest: number): string {
  return '█'.repeat(Math.max(1, Math.round((count / largest) * BAR_WIDTH)))
}

// The width of the Mistake column in a Top mistakes row, so the row fits the pane on one line. The row holds the
// arrow and "# ", the rank, the type, the mistake and the count column: the bar, the largest count and the recurring
// mark ("████ 68 ⟳").
export function mistakeColumn(paneWidth: number, largest: number): number {
  const countWidth = BAR_WIDTH + 1 + String(largest).length + 2
  return Math.max(8, paneWidth - 2 - 3 - TYPE_WIDTH - 1 - 1 - countWidth)
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

async function openPane($: EngineInterface) {
  await update($, isOpen, () => true)
  await $.ui.open({ id: PANE, title: '✎ Grammar', focus: true, closeOnEscape: true })
  await refreshTop($)
}

async function closePane($: EngineInterface) {
  await update($, isOpen, () => false)
  await $.ui.close({ id: PANE })
}

export const register: Register = on => {
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await update($, isOpen, () => false)
    return next(e)
  })

  // At the end of each main-loop turn, saves the check with the tracker's stop hook and keeps it for the band and pane.
  // A turn without a check clears it, so the band and pane never show the check of an older prompt.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer') return result
    try {
      const input = { session_id: await $.session.id(), cwd: await $.session.cwd(), last_assistant_message: e.answer }
      const stdout = await runScript($, ['stop_hook.py'], JSON.stringify(input))
      const output: StopHookOutput = stdout.trim() ? JSON.parse(stdout) : {}
      const check = toCheck(output)
      await update($, last, () => check)
      if (!check && output.systemMessage) $.ui.toast(output.systemMessage)
      if (await read($, isOpen)) await refreshTop($)
    } catch (error) {
      await update($, last, () => null)
      $.ui.toast(`Grammar tracker: failed to read the check (${String(error)})`)
    }
    return result
  })

  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    if (!e.props.isFirstOfReply) return next(e)
    const text = stripCheck(e.props.text)
    return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text } })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const check = await read($, last)
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const shown = await read($, isOpen)
    return (
      <Box flexDirection="column">
        {await next(e)}
        <Box>
          <Text dimColor>{check === null ? NO_CHECK_LINE : bandLine(check)}   </Text>
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
    const current: PaneTab = await read($, tab)
    const tabButton = (id: PaneTab, label: string) => (
      <Button key={`tab-${id}`} plain onPress={() => update($, tab, () => id)}>
        {current === id
          ? <Text bold color="inverseText" backgroundColor={ACCENT}>{` ${label} `}</Text>
          : <Text dimColor>{` ${label} `}</Text>}
      </Button>
    )
    // The keys, on the last row the pane shows: the pane has no footer of its own, so the row moves with the scroll.
    const { offset, bodyRows } = e.props.scroll
    const keys: [string, string, string, () => void][] = [
      ['tab-next', 't', 'Tab', () => void update($, tab, t => (t === 'last' ? 'top' : 'last'))],
      ['hide', 'h', 'Hide', () => void closePane($)],
    ]
    const used = keys.reduce((n, [, hotkey, label]) => n + hotkey.length + label.length + 4, 0)
    const footer = (
      <Box position="absolute" top={offset + bodyRows - 1} left={0} width={width}>
        {keys.map(([key, hotkey, label, press]) => [
          <Button key={key} plain hotkey={hotkey} dimColor onPress={press}>{label}</Button>,
          <Text key={`${key}-gap`}>{'  '}</Text>,
        ])}
        <Text>{' '.repeat(Math.max(0, width - used))}</Text>
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
      ...(o.reason ? [<Text key="reason">{o.reason}</Text>] : []),
    ]
    const example = (o: Occurrence) => (o.typeExample ? `Example: ${o.typeExample}` : '')

    const lastTab = (check: GrammarCheck & { doesNotApply: false }) => (
      <Box flexDirection="column">
        {check.occurrences.length === 0 ? <Text color="success">✓ No mistakes</Text> : null}
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
      const cardWidth = width - 2
      return (
        <Box flexDirection="column">
          <Text dimColor>{`  ${cell('#', 3)}${cell('Type', TYPE_WIDTH)} ${cell('Mistake', mistakeWidth)} Count`}</Text>
          {mistakes.map((o, n) => {
            const id = `${o.type}:${o.identifier}`
            const isOpen = open === id
            const row = (
              <Button key={`row-${n}`} plain onPress={() => update($, openRow, () => (isOpen ? null : id))}>
                {`${isOpen ? '▾' : '▸'} ${cell(String(n + 1), 3)}${cell(capitalize(o.typeLabel), TYPE_WIDTH)} `}
                {`${cell(o.identifier, mistakeWidth)} `}
                <Text color={o.isRecurring ? 'warning' : 'suggestion'}>{bar(o.count, largest)}</Text>
                {` ${o.count}${o.isRecurring ? ' ⟳' : ''}`}
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
        </Box>
      )
    }

    const topMistakes = await read($, top)
    return (
      <Box flexDirection="column" width={width} minHeight={bodyRows} paddingBottom={1}>
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
