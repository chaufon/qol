import type { Elements } from 'claude-code'

import type { Focus, GrammarCheck, Occurrence, PaneTab, TopMistake, TopMistakes, TopReport, TopTotals } from '../types'
import {
  ACCENT,
  BAR_WIDTH,
  RECENT_WIDTH,
  barFill,
  capitalize,
  cell,
  countColumn,
  meter,
  rowColumns,
  plural,
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
const OPEN_ALL = 'Open all'
const CLOSE_ALL = 'Close all'
const TOP_EMPTY = 'The mistakes of your checked prompts will show here.'
const RECENT_CAPTION = '+N: last 7 days'
const FOCUS_TITLE = 'Focus next'
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
  /** The open rows and Focus next items of the Top mistakes tab, by id. */
  openRows: string[]
  /** Whether the cards show their type's rule, except the cards whose own button turned it the other way. */
  isRulesShown: boolean
  /** The cards of the Last prompt tab whose button turned their rule the other way, by `cardId`. */
  flippedRules: string[]
}

export interface PaneActions {
  showTab: (id: PaneTab) => Promise<void>
  hide: () => Promise<void>
  /** Opens or closes one row or Focus next item of the Top mistakes tab. */
  toggleRow: (id: string) => Promise<void>
  /** Opens every row and Focus next item of the Top mistakes tab, by id, or closes them all when any is open. */
  toggleAll: (ids: string[]) => Promise<void>
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

/** The id of a Top mistakes row, which opens its example card. */
function rowId(o: TopMistake): string {
  return `${o.type}:${o.identifier}`
}

/** The id of a Focus next item, which opens its type's rule. */
function focusId(f: Focus): string {
  return `focus:${f.kind}`
}

/** The ids of everything the Top mistakes tab can open, for the footer key that opens or closes them all. */
function openableIds(report: TopReport): string[] {
  return [...report.mistakes.map(rowId), ...report.focus.map(focusId)]
}

function topRow(
  ui: Ui,
  o: TopMistake,
  n: number,
  columns: { type: number; mistake: number; count: number; largest: number },
  isOpen: boolean,
  onPress: () => Promise<void>,
): El {
  const { Button, Text } = ui
  const filled = barFill(o.count, columns.largest)
  return (
    <Button key={`row-${n}`} plain onPress={onPress}>
      {`${isOpen ? '▾' : '▸'}${String(n + 1).padStart(3)} `}
      <Text color={typeColor(o.type)}>{typeIcon(o.type)}</Text>
      {` ${cell(capitalize(o.typeLabel), columns.type)}  ${cell(o.identifier, columns.mistake)} `}
      {'█'.repeat(filled)}
      <Text dimColor>{'░'.repeat(BAR_WIDTH - filled)}</Text>
      {` ${String(o.count).padStart(columns.count)}`}
      {o.recent > 0 ? (
        <Text dimColor>{`+${o.recent}`.padStart(RECENT_WIDTH)}</Text>
      ) : (
        <Text color="success">{'–'.padStart(RECENT_WIDTH)}</Text>
      )}
    </Button>
  )
}

/** A dim line with `left` at its start and `right` at its end. */
function caption({ Text }: Ui, key: string, left: string, right: string, width: number): El {
  return (
    <Text key={key} dimColor>
      {left + ' '.repeat(Math.max(1, width - left.length - right.length)) + right}
    </Text>
  )
}

/** The line of a Focus next item: what the database found, in one sentence. */
function focusLine(f: Focus, topSize: number): string {
  const label = capitalize(f.typeLabel)
  switch (f.kind) {
    case 'type':
      return `${label}: ${f.rows} of your top ${topSize}, ${plural(f.count, 'time')}.`
    case 'rising':
      return `${label} "${f.identifier}": ${plural(f.recent, 'time')} in the last 7 days, ${f.aboveUsual} more than your usual rate.`
    case 'fading':
      return `Getting better: ${label} "${f.identifier}" did not come back in the last 7 days.`
  }
}

function focusCard(ui: Ui, report: TopReport, width: number, openRows: string[], actions: PaneActions): El {
  const { Box, Button, Text } = ui
  const body = report.focus.flatMap(f => {
    const id = focusId(f)
    const isOpen = openRows.includes(id)
    const isFading = f.kind === 'fading'
    const rule = `${f.typeDescription}${f.typeExample ? ` (${f.typeExample})` : ''}`
    const toggle = () => actions.toggleRow(id)
    return [
      // The mark and the icon sit in a column of their own, so a long line wraps under its text.
      <Box key={`focus-${f.kind}`}>
        <Box width={4} flexShrink={0}>
          <Button key={`focus-${f.kind}-mark`} plain onPress={toggle}>
            {`${isOpen ? '▾' : '▸'} `}
            <Text color={isFading ? 'success' : typeColor(f.type)}>{isFading ? '✓' : typeIcon(f.type)}</Text>
          </Button>
        </Box>
        <Box flexGrow={1} flexShrink={1}>
          <Button key={`focus-${f.kind}`} plain onPress={toggle}>
            {focusLine(f, report.mistakes.length)}
          </Button>
        </Box>
      </Box>,
      ...(isOpen
        ? [
            <Box key={`rule-${f.kind}`} paddingLeft={4}>
              <Text dimColor>→ {rule}</Text>
            </Box>,
          ]
        : []),
    ]
  })
  return card(ui, 'focus', FOCUS_TITLE, width, 'warning', body)
}

function topStats(ui: Ui, totals: TopTotals, width: number): El {
  const { Box } = ui
  const statWidth = Math.floor((width - 3) / 4)
  const clean = totals.prompts === 0 ? '–' : `${String(Math.round((totals.cleanPrompts / totals.prompts) * 100))}%`
  return (
    <Box key="stats" gap={1}>
      {stat(ui, 'mistakes', String(totals.mistakes), 'Mistakes', totals.mistakes > 0 ? 'error' : 'success', statWidth)}
      {stat(ui, 'prompts', String(totals.prompts), 'Prompts', undefined, statWidth)}
      {stat(
        ui,
        'recurring',
        String(totals.recurring),
        'Recurring',
        totals.recurring > 0 ? 'warning' : 'success',
        statWidth,
      )}
      {stat(ui, 'clean', clean, 'Clean', totals.cleanPrompts > 0 ? 'success' : undefined, statWidth)}
    </Box>
  )
}

function topTab(ui: Ui, width: number, report: TopReport, openRows: string[], actions: PaneActions): El {
  const { Box, Text } = ui
  const { totals, mistakes } = report
  if (totals.prompts === 0) return <Text dimColor>{TOP_EMPTY}</Text>
  const stats = topStats(ui, totals, width)
  const largest = mistakes[0]?.count
  if (largest === undefined) {
    return (
      <Box flexDirection="column" gap={1} paddingTop={1}>
        {stats}
        <Text key="clean" weight="semibold" color="success">
          {`✓ No mistakes in ${plural(totals.prompts, 'prompt')}.`}
        </Text>
      </Box>
    )
  }
  const columns = { ...rowColumns(width, largest), count: countColumn(largest), largest }
  const cardWidth = width - 2
  const list = mistakes.map((o, n) => {
    const id = rowId(o)
    const isOpen = openRows.includes(id)
    const row = topRow(ui, o, n, columns, isOpen, () => actions.toggleRow(id))
    if (!isOpen) return row
    const title = `${typeIcon(o.type)} ${capitalize(o.typeLabel)} · "${o.identifier}"`
    const body = [...sentences(ui, o), ...ruleSection(ui, o, cardWidth, 'inactive')]
    return (
      <Box key={`mistake-${n}`} flexDirection="column">
        {row}
        <Box marginLeft={2}>{card(ui, 'example', title, cardWidth, 'inactive', body)}</Box>
      </Box>
    )
  })
  return (
    <Box flexDirection="column" gap={1} paddingTop={1}>
      {stats}
      <Box key="top" flexDirection="column">
        {caption(ui, 'caption', `Top ${mistakes.length} · all time`, RECENT_CAPTION, width)}
        {list}
      </Box>
      {report.focus.length > 0 ? focusCard(ui, report, width, openRows, actions) : null}
    </Box>
  )
}

/**
 * The keys, on the last row the pane shows, under a line: the pane has no footer of its own, so the two rows move with
 * the scroll. The Last prompt tab adds the key that shows or hides the type's rule on every card, and the Top mistakes
 * tab the key that opens or closes every row and Focus next item.
 */
function openAllKey(report: TopReport, openRows: string[], actions: PaneActions): Key {
  const ids = openableIds(report)
  const isAnyOpen = ids.some(id => openRows.includes(id))
  return ['open-all', 'o', isAnyOpen ? CLOSE_ALL : OPEN_ALL, () => actions.toggleAll(ids)]
}

function footer({ Box, Button, Text }: Ui, p: PaneProps, actions: PaneActions): El {
  const keys: Key[] = [
    ['tab-next', 't', 'Tab', () => actions.showTab(p.tab === 'last' ? 'top' : 'last')],
    ['hide', 'h', 'Hide', actions.hide],
    ...(p.tab === 'last' ? [['rules', 'r', p.isRulesShown ? HIDE_RULES : SHOW_RULES, actions.toggleRules] as Key] : []),
    ...(p.tab === 'top' && p.top !== null && !('error' in p.top) && p.top.mistakes.length > 0
      ? [openAllKey(p.top, p.openRows, actions)]
      : []),
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
    return topTab(ui, p.width, p.top, p.openRows, actions)
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
