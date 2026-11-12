import type { Elements } from 'claude-code'

import type { GrammarCheck, Occurrence, PaneTab, TopMistakes } from '../types'
import {
  ACCENT,
  BAR_WIDTH,
  TYPE_WIDTH,
  barFill,
  capitalize,
  cell,
  cleanStreak,
  countColumn,
  meter,
  mistakeColumn,
  plural,
  shareCells,
  sparkline,
  typeColor,
  typeIcon,
} from './format'
import { mascotRows } from './mascot'
import type { Mood } from './mascot'

type Ui = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>
type El = JSX.Element
type Mistakes = GrammarCheck & { doesNotApply: false }

const NOT_APPLY_LINE = 'Grammar check does not apply to the last prompt'
const NO_MISTAKES_LINE = 'No mistakes. Great English, keep it up!'
const NO_CHECK_LINE = 'Grammar: no check for the last prompt'
const CHECKING_LINE = '⠋ Checking…'
const CHECKING_PANE = '⠋ Checking this prompt…'

export interface Chip {
  text: string
  color?: string
  isDim?: boolean
}

/** The chips of the band for a check: the does-not-apply line, the praise, or the mistakes and the recurring ones. */
export function bandChips(check: GrammarCheck | null): Chip[] {
  if (check === null) return [{ text: NO_CHECK_LINE, isDim: true }]
  if (check.doesNotApply) return [{ text: NOT_APPLY_LINE, isDim: true }]
  const total = check.occurrences.length
  if (total === 0) return [{ text: '✓ No mistakes', color: 'success' }]
  const recurring = check.occurrences.filter(o => o.isRecurring).length
  return [
    { text: `✗ ${plural(total, 'mistake')}`, color: 'error' },
    ...(recurring > 0 ? [{ text: `⟳ ${recurring} recurring`, color: 'warning' }] : []),
  ]
}

export interface BandProps {
  check: GrammarCheck | null
  isPending: boolean
  isShown: boolean
  above: El
}

export function drawBand({ Box, Button, Text }: Ui, p: BandProps, toggle: () => Promise<void>): El {
  return (
    <Box flexDirection="column">
      {p.above}
      <Box>
        {p.isPending ? (
          <Text color={ACCENT}>{CHECKING_LINE}</Text>
        ) : (
          <Box gap={1}>
            <Text color={ACCENT}>✎</Text>
            {bandChips(p.check).map((chip, n) => [
              ...(n > 0
                ? [
                    <Text key={`dot-${n}`} dimColor>
                      ·
                    </Text>,
                  ]
                : []),
              <Text key={`chip-${n}`} color={chip.color} dimColor={chip.isDim}>
                {chip.text}
              </Text>,
            ])}
          </Box>
        )}
        <Text>{'   '}</Text>
        <Button key="toggle" hotkey="g" plain onPress={toggle}>
          {p.isShown ? 'Hide' : 'Show'}
        </Button>
      </Box>
    </Box>
  )
}

export interface PaneProps {
  width: number
  scroll: { offset: number; bodyRows: number }
  tab: PaneTab
  check: GrammarCheck | null
  isPending: boolean
  top: TopMistakes
  trend: number[] | null
  openRow: string | null
}

export interface PaneActions {
  showTab: (id: PaneTab) => Promise<void>
  hide: () => Promise<void>
  toggleRow: (id: string) => Promise<void>
}

/**
 * A bordered card whose title is painted over its top border, cut with an ellipsis where the border is too short.
 * `right` is painted over the right end of the border, and left out where the border has no room for it.
 */
function card(
  { Box, Text }: Ui,
  key: string,
  title: string,
  width: number,
  borderColor: string,
  body: El[],
  right?: { text: string; color: string },
): El {
  const hasRight = right !== undefined && title.length + right.text.length + 10 <= width
  return (
    <Box key={key} flexDirection="column" width={width} marginTop={1}>
      <Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={1}>
        {body}
      </Box>
      <Box position="absolute" top={0} left={2} width={Math.min(title.length + 2, width - 4)}>
        <Text weight="semibold" color={borderColor} wrap="truncate-end">{` ${title} `}</Text>
      </Box>
      {hasRight ? (
        <Box position="absolute" top={0} left={width - right.text.length - 4} width={right.text.length + 2}>
          <Text color={right.color}>{` ${right.text} `}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

function fitsBorder(title: string, width: number): boolean {
  return title.length + 2 <= width - 4
}

function sentences({ Text }: Ui, o: Occurrence): El[] {
  return [
    <Text key="original" color="error">
      ✗ {o.original}
    </Text>,
    <Text key="corrected" color="success">
      ✓ {o.corrected}
    </Text>,
    ...(o.reason
      ? [
          <Text key="reason" dimColor>
            {o.reason}
          </Text>,
        ]
      : []),
  ]
}

function example(o: Occurrence): string {
  return o.typeExample ? `Example: ${o.typeExample}` : ''
}

function tile({ Box, Text }: Ui, id: string, value: string, label: string, color: string | undefined, width: number) {
  return (
    <Box key={id} width={width} borderStyle="round" borderColor="inactive" flexDirection="column" alignItems="center">
      <Text weight="semibold" color={color} dimColor={color === undefined}>
        {value}
      </Text>
      <Text dimColor wrap="truncate-end">
        {label}
      </Text>
    </Box>
  )
}

/** The mascot beside a headline and the line under it. */
function header({ Box, Text }: Ui, mood: Mood, headline: El, subline: string): El {
  return (
    <Box gap={2} marginTop={1}>
      <Box flexDirection="column">
        {mascotRows(mood).map((row, n) => (
          <Text key={`mascot-${n}`}>
            {row.map((run, i) => (
              <Text key={String(i)} color={run.color} backgroundColor={run.backgroundColor}>
                {run.text}
              </Text>
            ))}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" justifyContent="center" flexShrink={1}>
        {headline}
        {subline ? <Text dimColor>{subline}</Text> : null}
      </Box>
    </Box>
  )
}

function lastTab(ui: Ui, width: number, check: Mistakes, counts: number[] | null): El {
  const { Box, Text } = ui
  const mistakes = check.occurrences.length
  const recurring = check.occurrences.filter(o => o.isRecurring)
  const streak = counts === null ? null : cleanStreak(counts)
  const tileWidth = Math.floor((width - 2) / 3)
  const repeating = recurring.length > 0 ? `${recurring.length} you keep repeating` : 'none recurring'
  const headline =
    mistakes === 0 ? (
      <Text weight="semibold" color="success">
        ✓ {NO_MISTAKES_LINE}
      </Text>
    ) : (
      <Text
        weight="semibold"
        color={recurring.length > 0 ? 'warning' : undefined}
      >{`${plural(mistakes, 'mistake')}, ${repeating}.`}</Text>
    )
  const watch = recurring.toSorted((a, b) => b.count - a.count)[0]
  const subline =
    mistakes === 0
      ? streak !== null && streak > 1
        ? `${streak} prompts in a row with no mistakes`
        : ''
      : watch
        ? `Watch out for "${watch.identifier}" (×${watch.count})`
        : 'Corrected prompt below'
  return (
    <Box flexDirection="column">
      {header(ui, recurring.length > 0 ? 'worried' : 'happy', headline, subline)}
      <Box gap={1} marginTop={1}>
        {tile(ui, 'mistakes', String(mistakes), 'Mistakes', mistakes > 0 ? 'error' : 'success', tileWidth)}
        {tile(
          ui,
          'recurring',
          String(recurring.length),
          'Recurring',
          recurring.length > 0 ? 'warning' : 'success',
          tileWidth,
        )}
        {tile(
          ui,
          'streak',
          streak === null ? '–' : String(streak),
          'Clean streak',
          streak ? 'success' : undefined,
          tileWidth,
        )}
      </Box>
      {counts !== null && counts.length > 1 ? (
        <Box>
          <Text dimColor>{'Conversation '}</Text>
          {sparkline(counts).map((bar, n) => (
            <Text key={String(n)} color={counts[n] === 0 ? 'success' : 'warning'}>
              {bar}
            </Text>
          ))}
          <Text dimColor>{` last ${counts.length} prompts`}</Text>
        </Box>
      ) : null}
      {check.occurrences.map((o, n) => {
        const title = `${typeIcon(o.type)} ${capitalize(o.typeLabel)} · "${o.identifier}"`
        const rule = `${o.typeDescription}${o.typeExample ? ` (${o.typeExample})` : ''}`
        const color = o.isRecurring ? 'warning' : 'inactive'
        const right = { text: `${meter(o.count)} ×${o.count}${o.isRecurring ? ' ⟳' : ''}`, color }
        const body = [
          ...sentences(ui, o),
          <Text key="rule" dimColor>
            {rule}
          </Text>,
        ]
        return card(ui, `o${n}`, title, width, color, body, right)
      })}
      {card(ui, 'corrected', '✎ Corrected prompt', width, 'suggestion', [
        <Text key="text">{check.correctedPrompt}</Text>,
      ])}
    </Box>
  )
}

/** The share of each mistake type in the sum of the counters, largest first. */
function typeShares(mistakes: Occurrence[]): [string, number][] {
  const byType = new Map<string, number>()
  for (const o of mistakes) byType.set(o.type, (byType.get(o.type) ?? 0) + o.count)
  return [...byType.entries()].sort((a, b) => b[1] - a[1])
}

/** The legend under the share bar: the icon and percentage of as many types as fit on one line. */
function legendItems(types: [string, number][], total: number, width: number): { type: string; text: string }[] {
  const items: { type: string; text: string }[] = []
  let used = 0
  for (const [type, n] of types) {
    const text = `${typeIcon(type)} ${String(Math.round((n / total) * 100))}%`
    const gap = items.length > 0 ? 2 : 0
    if (used + gap + text.length > width) break
    used += gap + text.length
    items.push({ type, text })
  }
  return items
}

function topRow(
  ui: Ui,
  o: Occurrence,
  n: number,
  columns: { mistake: number; count: number; largest: number },
  isOpen: boolean,
  onPress: () => Promise<void>,
): El {
  const { Button, Text } = ui
  const color = o.isRecurring ? 'warning' : 'success'
  const filled = barFill(o.count, columns.largest)
  return (
    <Button key={`row-${n}`} plain onPress={onPress}>
      {`${isOpen ? '▾' : ' '}${String(n + 1).padStart(3)} `}
      <Text color={typeColor(o.type)}>{typeIcon(o.type)}</Text>
      {` ${cell(capitalize(o.typeLabel), TYPE_WIDTH)}  ${cell(o.identifier, columns.mistake)} `}
      <Text color={color}>{'█'.repeat(filled)}</Text>
      <Text dimColor>{'░'.repeat(BAR_WIDTH - filled)}</Text>
      <Text color={color}>{` ${String(o.count).padStart(columns.count)}`}</Text>
    </Button>
  )
}

function topTab(ui: Ui, width: number, mistakes: Occurrence[], openRow: string | null, actions: PaneActions): El {
  const { Box, Text } = ui
  const byCount = mistakes.toSorted((a, b) => b.count - a.count)
  const mostFrequent = byCount[0]
  if (mostFrequent === undefined) return <Text dimColor>No mistakes logged yet</Text>
  const watch = byCount.find(o => o.isRecurring)
  const recurring = mistakes.filter(o => o.isRecurring).length
  const largest = mostFrequent.count
  const columns = { mistake: mistakeColumn(width, largest), count: countColumn(largest), largest }
  const cardWidth = width - 2
  const total = mistakes.reduce((sum, o) => sum + o.count, 0)
  const tileWidth = Math.floor((width - 2) / 3)
  const types = typeShares(mistakes)
  const cells = shareCells(
    types.map(([, n]) => n),
    width - 2,
  )
  const shown = watch ?? mostFrequent
  const headline = (
    <Text weight="semibold" color={recurring > 0 ? 'warning' : 'success'}>
      {recurring > 0 ? `${plural(recurring, 'mistake')} you keep repeating.` : 'No mistake you keep repeating.'}
    </Text>
  )
  const subline = `${watch ? 'Watch out for' : 'Most frequent:'} "${shown.identifier}" (×${shown.count})`
  return (
    <Box flexDirection="column">
      {header(ui, recurring > 0 ? 'worried' : 'happy', headline, subline)}
      <Box gap={1} marginTop={1}>
        {tile(ui, 'mistakes', String(total), 'Mistakes', 'error', tileWidth)}
        {tile(ui, 'recurring', String(recurring), 'Recurring', recurring > 0 ? 'warning' : 'success', tileWidth)}
        {tile(ui, 'types', String(types.length), 'Types', undefined, tileWidth)}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{`Where your mistakes go (top ${mistakes.length})`}</Text>
      </Box>
      <Text>
        {cells.map((n, i) => (
          <Text key={String(i)} color={typeColor(types[i]?.[0] ?? 'other')}>
            {'█'.repeat(n)}
          </Text>
        ))}
      </Text>
      <Text>
        {legendItems(types, total, width - 2).map((item, i) => (
          <Text key={item.type} color={typeColor(item.type)}>{`${i > 0 ? '  ' : ''}${item.text}`}</Text>
        ))}
      </Text>
      <Text> </Text>
      {mistakes.map((o, n) => {
        const id = `${o.type}:${o.identifier}`
        const isOpen = openRow === id
        const row = topRow(ui, o, n, columns, isOpen, () => actions.toggleRow(id))
        if (!isOpen) return row
        const rule = fitsBorder(o.typeDescription, cardWidth) ? example(o) : `${o.typeDescription} ${example(o)}`
        const body = [
          ...(rule.trim()
            ? [
                <Text key="rule" dimColor>
                  {rule.trim()}
                </Text>,
              ]
            : []),
          ...sentences(ui, o),
        ]
        return (
          <Box key={`mistake-${n}`} flexDirection="column">
            {row}
            <Box marginLeft={2} marginBottom={1}>
              {card(ui, 'example', o.typeDescription, cardWidth, o.isRecurring ? 'warning' : 'inactive', body)}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

/**
 * The keys, on the last row the pane shows, under a line: the pane has no footer of its own, so the two rows move with
 * the scroll.
 */
function footer({ Box, Button, Text }: Ui, p: PaneProps, actions: PaneActions): El {
  const keys: [string, string, string, () => Promise<void>][] = [
    ['tab-next', 't', 'Tab', () => actions.showTab(p.tab === 'last' ? 'top' : 'last')],
    ['hide', 'h', 'Hide', actions.hide],
  ]
  const used = keys.reduce((n, [, hotkey, label]) => n + hotkey.length + label.length + 4, 0)
  return (
    <Box
      position="absolute"
      top={p.scroll.offset + p.scroll.bodyRows - 2}
      left={0}
      width={p.width}
      flexDirection="column"
    >
      <Text dimColor>{'─'.repeat(p.width)}</Text>
      <Box>
        {keys.map(([key, hotkey, label, press]) => [
          <Button key={key} plain hotkey={hotkey} dimColor onPress={press}>
            {label}
          </Button>,
          <Text key={`${key}-gap`}>{'  '}</Text>,
        ])}
        <Text>{' '.repeat(Math.max(0, p.width - used))}</Text>
      </Box>
    </Box>
  )
}

function tabBody(ui: Ui, p: PaneProps, actions: PaneActions): El {
  const { Text } = ui
  if (p.tab === 'top') {
    if (p.top === null) return <Text dimColor>Loading…</Text>
    if ('error' in p.top) return <Text color="error">{p.top.error}</Text>
    return topTab(ui, p.width, p.top.mistakes, p.openRow, actions)
  }
  if (p.isPending) return <Text color={ACCENT}>{CHECKING_PANE}</Text>
  if (p.check === null) return <Text dimColor>No grammar check for the last prompt.</Text>
  if (p.check.doesNotApply) return <Text dimColor>{NOT_APPLY_LINE}</Text>
  return lastTab(ui, p.width, p.check, p.trend)
}

export function drawPane(ui: Ui, p: PaneProps, actions: PaneActions): El {
  const { Box, Button, Text } = ui
  const tabButton = (id: PaneTab, label: string) => (
    <Button key={`tab-${id}`} plain onPress={() => actions.showTab(id)}>
      {p.tab === id ? (
        <Text weight="semibold" color="inverseText" backgroundColor={ACCENT}>{` ${label} `}</Text>
      ) : (
        <Text dimColor>{` ${label} `}</Text>
      )}
    </Button>
  )
  return (
    <Box flexDirection="column" width={p.width} minHeight={p.scroll.bodyRows} paddingBottom={2}>
      <Text dimColor>{'─'.repeat(p.width)}</Text>
      <Box gap={1}>
        {tabButton('last', 'Last prompt')}
        {tabButton('top', 'Top mistakes')}
      </Box>
      <Text dimColor>{'─'.repeat(p.width)}</Text>
      {tabBody(ui, p, actions)}
      {footer(ui, p, actions)}
    </Box>
  )
}
