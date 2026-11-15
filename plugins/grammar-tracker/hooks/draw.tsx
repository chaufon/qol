import type { Elements } from 'claude-code'

import type { GrammarCheck, Occurrence, PaneTab, TopMistakes } from '../types'
import {
  ACCENT,
  BAR_WIDTH,
  TYPE_WIDTH,
  barFill,
  capitalize,
  cell,
  countColumn,
  meter,
  mistakeColumn,
  plural,
  shareCells,
  typeColor,
  typeIcon,
  wordDiff,
} from './format'
import type { Segment } from './format'

type Ui = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>
type El = JSX.Element
type Mistakes = GrammarCheck & { doesNotApply: false }
type Key = [string, string, string, () => Promise<void>]

const NOT_APPLY_LINE = 'Grammar check does not apply to the last prompt'
const NO_MISTAKES_LINE = '✓ No mistakes.'
const NO_CHECK_LINE = 'Grammar: no check for the last prompt'
const CHECKING_LINE = '⠋ Checking…'
const CHECKING_PANE = '⠋ Checking this prompt…'
const SHOW_RULE = '▸ Show rule'
const HIDE_RULE = '▾ Hide rule'
const SHOW_RULES = 'Show rules'
const HIDE_RULES = 'Hide rules'
/** How close to the best streak, in prompts still needed to beat it, the clean line starts counting down. */
const NEAR_BEST = 3

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
  openRow: string | null
  /** Whether the cards show their type's rule, except the cards whose own button turned it the other way. */
  isRulesShown: boolean
  /** The cards of the Last prompt tab whose button turned their rule the other way, by `cardId`. */
  flippedRules: string[]
}

export interface PaneActions {
  showTab: (id: PaneTab) => Promise<void>
  hide: () => Promise<void>
  toggleRow: (id: string) => Promise<void>
  /** Shows or hides the type's rule on every card. */
  toggleRules: () => Promise<void>
  /** Shows or hides the type's rule on one card, by `cardId`. */
  toggleRule: (id: string) => Promise<void>
}

/** The id of the n-th mistake card of the Last prompt tab. */
export function cardId(n: number): string {
  return `o${n}`
}

/** A pressable label painted over the right end of a card's bottom border. */
interface BorderButton {
  key: string
  label: string
  onPress: () => Promise<void>
}

/**
 * A bordered card whose title is painted over its top border, cut with an ellipsis where the border is too short.
 * `right` is painted over the right end of the top border and `button` over the right end of the bottom border; each
 * is left out where its border has no room for it.
 */
function card(
  { Box, Button, Text }: Ui,
  key: string,
  title: string,
  width: number,
  borderColor: string,
  body: El[],
  right?: { text: string; color: string },
  button?: BorderButton,
): El {
  const hasRight = right !== undefined && title.length + right.text.length + 10 <= width
  const hasButton = button !== undefined && button.label.length + 8 <= width
  return (
    <Box key={key} flexDirection="column" width={width}>
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
      {hasButton ? (
        <Box position="absolute" bottom={0} left={width - button.label.length - 4} width={button.label.length + 2}>
          <Button key={button.key} plain dimColor onPress={button.onPress}>
            {` ${button.label} `}
          </Button>
        </Box>
      ) : null}
    </Box>
  )
}

function fitsBorder(title: string, width: number): boolean {
  return title.length + 2 <= width - 4
}

function runs({ Text }: Ui, parts: Segment[], color: string, changedColor: string): El[] {
  return parts.map((part, n) =>
    part.isChanged ? (
      <Text key={String(n)} color="text" backgroundColor={changedColor}>
        {part.text}
      </Text>
    ) : (
      <Text key={String(n)} color={color}>
        {part.text}
      </Text>
    ),
  )
}

/** The wrong and the corrected sentence, with the words the correction changed highlighted, then the reason. */
function sentences(ui: Ui, o: Occurrence): El[] {
  const { Text } = ui
  const diff = wordDiff(o.original, o.corrected)
  return [
    <Text key="original">
      <Text color="error">✗ </Text>
      {runs(ui, diff.wrong, 'error', 'diffRemovedWord')}
    </Text>,
    <Text key="corrected">
      <Text color="success">✓ </Text>
      {runs(ui, diff.corrected, 'success', 'diffAddedWord')}
    </Text>,
    ...(o.reason
      ? [
          <Text key="reason" dimColor>
            ↳ {o.reason}
          </Text>,
        ]
      : []),
  ]
}

function example(o: Occurrence): string {
  return o.typeExample ? `Example: ${o.typeExample}` : ''
}

function stat({ Box, Text }: Ui, id: string, value: string, label: string, color: string | undefined, width: number) {
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

/** The line a clean prompt shows: the streak it extends, measured against the longest one before it. */
export function cleanLine(streak: number | undefined, bestBefore: number | undefined): string {
  if (streak === undefined || bestBefore === undefined) return NO_MISTAKES_LINE
  if (streak <= 1) return `${NO_MISTAKES_LINE} A new streak starts.`
  if (streak > bestBefore) return `${NO_MISTAKES_LINE} ${streak} in a row: your best streak yet!`
  if (streak === bestBefore) return `${NO_MISTAKES_LINE} ${streak} in a row: you matched your best streak!`
  const toBeat = bestBefore - streak + 1
  if (toBeat <= NEAR_BEST) return `${NO_MISTAKES_LINE} ${streak} in a row, ${toBeat} more to beat your best.`
  return `${NO_MISTAKES_LINE} ${streak} prompts in a row!`
}

/** The type's rule of a card under a dashed line: its description and its example. */
function ruleSection({ Text }: Ui, o: Occurrence, width: number, color: string): El[] {
  const rule = `${o.typeDescription}${o.typeExample ? ` (${o.typeExample})` : ''}`
  return [
    <Text key="divider" color={color} dimColor>
      {'╌'.repeat(Math.max(0, width - 4))}
    </Text>,
    <Text key="rule" dimColor>
      → {rule}
    </Text>,
  ]
}

function lastTab(ui: Ui, p: PaneProps, check: Mistakes, actions: PaneActions): El {
  const { Box, Text } = ui
  const mistakes = check.occurrences.length
  const recurring = check.occurrences.filter(o => o.isRecurring).length
  const { streak, bestBefore } = check
  const best = streak === undefined || bestBefore === undefined ? undefined : Math.max(streak, bestBefore)
  const isBestReached = streak !== undefined && streak > 0 && streak === best
  const statWidth = Math.floor((p.width - 3) / 4)
  const stats = (
    <Box key="stats" gap={1}>
      {stat(ui, 'mistakes', String(mistakes), 'Mistakes', mistakes > 0 ? 'error' : 'success', statWidth)}
      {stat(ui, 'recurring', String(recurring), 'Recurring', recurring > 0 ? 'warning' : 'success', statWidth)}
      {stat(
        ui,
        'streak',
        streak === undefined ? '–' : String(streak),
        'Streak',
        streak ? 'success' : undefined,
        statWidth,
      )}
      {stat(
        ui,
        'best',
        best === undefined ? '–' : String(best),
        'Best',
        isBestReached ? 'success' : undefined,
        statWidth,
      )}
    </Box>
  )
  if (mistakes === 0) {
    return (
      <Box flexDirection="column" gap={1} paddingTop={1}>
        {stats}
        <Text key="clean" weight="semibold" color="success">
          {cleanLine(streak, bestBefore)}
        </Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="column" gap={1} paddingTop={1}>
      {stats}
      {check.occurrences.map((o, n) => {
        const id = cardId(n)
        const isRuleShown = p.isRulesShown !== p.flippedRules.includes(id)
        const title = `${typeIcon(o.type)} ${capitalize(o.typeLabel)} · "${o.identifier}"`
        const color = o.isRecurring ? 'warning' : 'inactive'
        const right = { text: `${meter(o.count)} ×${o.count}${o.isRecurring ? ' ⟳' : ''}`, color }
        const body = [...sentences(ui, o), ...(isRuleShown ? ruleSection(ui, o, p.width, color) : [])]
        const button = {
          key: `rule-${id}`,
          label: isRuleShown ? HIDE_RULE : SHOW_RULE,
          onPress: () => actions.toggleRule(id),
        }
        return card(ui, id, title, p.width, color, body, right, button)
      })}
      {card(ui, 'corrected', '✎ Corrected prompt', p.width, 'suggestion', [
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
  const statWidth = Math.floor((width - 2) / 3)
  const types = typeShares(mistakes)
  const cells = shareCells(
    types.map(([, n]) => n),
    width - 2,
  )
  const shown = watch ?? mostFrequent
  const subline = `${watch ? 'Watch out for' : 'Most frequent:'} "${shown.identifier}" (×${shown.count})`
  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginTop={1}>
        <Text weight="semibold" color={recurring > 0 ? 'warning' : 'success'}>
          {recurring > 0 ? `${plural(recurring, 'mistake')} you keep repeating.` : 'No mistake you keep repeating.'}
        </Text>
        <Text dimColor>{subline}</Text>
      </Box>
      <Box gap={1} marginTop={1}>
        {stat(ui, 'mistakes', String(total), 'Mistakes', 'error', statWidth)}
        {stat(ui, 'recurring', String(recurring), 'Recurring', recurring > 0 ? 'warning' : 'success', statWidth)}
        {stat(ui, 'types', String(types.length), 'Types', undefined, statWidth)}
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
            <Box marginLeft={2} marginTop={1} marginBottom={1}>
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
 * the scroll. The Last prompt tab adds the key that shows or hides the type's rule on every card.
 */
function footer({ Box, Button, Text }: Ui, p: PaneProps, actions: PaneActions): El {
  const keys: Key[] = [
    ['tab-next', 't', 'Tab', () => actions.showTab(p.tab === 'last' ? 'top' : 'last')],
    ['hide', 'h', 'Hide', actions.hide],
    ...(p.tab === 'last' ? [['rules', 'r', p.isRulesShown ? HIDE_RULES : SHOW_RULES, actions.toggleRules] as Key] : []),
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
  return lastTab(ui, p, p.check, actions)
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
