import type { Elements } from 'claude-code'

import type { Conversation, Costs, Grouping, History, Request, Tab, Tokens, Usage, View, WindowTotal } from '../types'
import { COLORS, fmtCost, fmtPrice, fmtTokens, hhmm, weekday } from './format'
import { conversationRows, historyTree, promptGroups, sumUsage } from './model'
import type { Node, PromptGroup, Row } from './model'
import {
  CACHE_WRITE_1H, CACHE_WRITE_5M, FAST_FACTOR, FAST_MODELS, LONG_CONTEXT_FACTOR, LONG_CONTEXT_MODEL,
  LONG_CONTEXT_TOKENS, PRICES, ZERO_TOKENS,
} from './prices'

export type Actions = {
  toggle(key: string, isOpen: boolean): void
  nextView(): void
  nextTab(): void
  nextGrouping(): void
  selectTab(t: Tab): void
  selectView(v: View): void
  selectGrouping(g: Grouping): void
  hide(): void
  loadDetails(conversationId: string): void
}

export type PaneProps = {
  width: number; tab: Tab; view: View; grouping: Grouping; current: Conversation | null
  windowTotals: WindowTotal[]; history: History; details: Record<string, Conversation>
  expanded: Record<string, boolean>; notice: string | null; now: number; isFullscreen: boolean
  scroll: { offset: number; bodyRows: number }
}

type Ui = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>
type El = JSX.Element
type Ctx = { ui: Ui; view: View; width: number; isFullscreen: boolean; scale: number; actions: Actions }

const HOVER = { backgroundColor: '#3a3f4b' }
const ACCENT = 'planMode'
const STRIPE = '#23272e'
const BAND = '#1b1e23'
const WHITE = '#ffffff'
const NUM = 3
const TIME = 6
const COL = 8
const PRICE_COL = 10
const ARROW = 2
const MARK = 4
const FIGURES = 5 * COL
const CHART_TOOLS = 12
const TOKEN_COLORS = [COLORS.input, COLORS.cacheWrite, COLORS.cacheRead, COLORS.output]
const VIEWS: [View, string][] = [['tokens', 'Tokens'], ['cost', 'Cost'], ['both', 'Both'], ['chart', 'Chart']]
const GROUPINGS: [Grouping, string][] = [['date', 'Date'], ['project', 'Project'], ['window', 'Window']]

const cell = (s: string, w: number): string => (s.length > w ? `${s.slice(0, Math.max(0, w - 1))}…` : s.padEnd(w))
const rcell = (s: string, w: number): string => s.padStart(w)
const quad = (t: Tokens): number[] => [t.input, t.cacheWrite5m + t.cacheWrite1h, t.cacheRead, t.output]
const total = (t: Tokens): number => quad(t).reduce((a, b) => a + b, 0)

// Cells for input, cache write, cache read and output; the sum is round(total / scale * width), at least 1 for a
// non-zero total, shared out by largest remainder.
export const barSegments = (tokens: Tokens, scale: number, width: number): [number, number, number, number] => {
  const parts = quad(tokens)
  const sum = parts.reduce((a, b) => a + b, 0)
  if (sum <= 0 || scale <= 0 || width <= 0) return [0, 0, 0, 0]
  const target = Math.min(width, Math.max(1, Math.round((sum / scale) * width)))
  const exact = parts.map((p) => (p / sum) * target)
  const cells = exact.map(Math.floor)
  let left = target - cells.reduce((a, b) => a + b, 0)
  const order = exact.map((x, i) => i).sort((a, b) => exact[b]! - cells[b]! - (exact[a]! - cells[a]!))
  for (const i of order) {
    if (left <= 0) break
    if (parts[i]! > 0) { cells[i]!++; left-- }
  }
  return cells as [number, number, number, number]
}

const ZERO_COSTS: Costs = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, total: 0 }

const toolsText = (tools: string[]): string => (tools.length ? tools.join(', ') : '—')
// The triangle at the start of a row that opens and closes (`▸` closed, `▾` open), and the count at its end.
type Mark = [arrow: string, count: string]
const NO_MARK: Mark = [' '.repeat(ARROW), ' '.repeat(MARK)]
const marker = (isOpen: boolean, n: number): Mark => [isOpen ? '▾ ' : '▸ ', rcell(String(n), MARK)]
const dashes = (w: number): string => '-'.repeat(Math.max(0, w - 1))

// The five figure columns of a usage in tokens or cost.
function figures(ui: Ui, u: Usage, kind: 'tokens' | 'cost'): El[] {
  const { Text } = ui
  if (kind === 'tokens') {
    return [
      ...quad(u.tokens).map((v, i) => <Text color={TOKEN_COLORS[i]}>{rcell(fmtTokens(v), COL)}</Text>),
      <Text bold color={WHITE}>{rcell(fmtTokens(total(u.tokens)), COL)}</Text>,
    ]
  }
  const c = u.cost
  return [c?.input, c?.cacheWrite, c?.cacheRead, c?.output, c?.total].map((v) => (
    <Text color={COLORS.cost}>{rcell(fmtCost(v ?? null), COL)}</Text>
  ))
}

// The lines of one row in the current view. `head(w)` draws the leading columns in exactly w cells;
// `scale` is the token total that fills the chart bar.
function viewLines(c: Ctx, head: (w: number) => El[], u: Usage, mark: Mark, scale: number): El[][] {
  const { Text } = c.ui
  const [arrow, count] = mark
  const labelW = c.width - ARROW - FIGURES - MARK
  if (c.view === 'chart') {
    const headW = NUM + TIME + CHART_TOOLS
    const barW = Math.max(6, c.width - ARROW - headW - 2 * COL - MARK - 1)
    const seg = barSegments(u.tokens, scale, barW)
    const used = seg.reduce((a, b) => a + b, 0)
    return [[
      <Text>{arrow}</Text>,
      ...head(headW),
      ...seg.map((n, i) => <Text color={TOKEN_COLORS[i]}>{'█'.repeat(n)}</Text>),
      <Text>{' '.repeat(barW - used + 1)}</Text>,
      <Text bold color={WHITE}>{rcell(fmtTokens(total(u.tokens)), COL)}</Text>,
      <Text color={COLORS.cost}>{rcell(fmtCost(u.cost?.total ?? null), COL)}</Text>,
      <Text>{count}</Text>,
    ]]
  }
  const tokens = [<Text>{arrow}</Text>, ...head(labelW), ...figures(c.ui, u, 'tokens'), <Text>{count}</Text>]
  const costs = [<Text>{arrow}</Text>, ...head(labelW), ...figures(c.ui, u, 'cost'), <Text>{count}</Text>]
  if (c.view === 'tokens') return [tokens]
  if (c.view === 'cost') return [costs]
  return [tokens, [<Text>{' '.repeat(ARROW + labelW)}</Text>, ...figures(c.ui, u, 'cost')]]
}

// One keyed row: stripe, hover in fullscreen, and an optional dim lead (the `│` of an expanded conversation).
function rowBox(c: Ctx, key: string, index: number, lines: El[], lead: string | null): El {
  const { Box, Text } = c.ui
  return (
    <Box
      key={`row:${key}`} flexDirection="column" backgroundColor={index % 2 === 1 ? STRIPE : undefined}
      hover={c.isFullscreen ? HOVER : undefined}
    >
      {lines.map((line) => (lead === null ? line : (
        <Box>
          <Text dimColor>{lead}</Text>
          {line}
        </Box>
      )))}
    </Box>
  )
}

function rowHead(c: Ctx, r: Row): (w: number) => El[] {
  const { Text } = c.ui
  return (w) => {
    const bars = '┃'.repeat(r.depth)
    const toolsW = Math.max(8, w - NUM - TIME - r.depth)
    if (r.kind === 'request') {
      return [
        <Text color={COLORS.subagent}>{bars}</Text>,
        <Text dimColor>{cell(String(r.number), NUM)}</Text>,
        <Text dimColor>{cell(hhmm(r.at), TIME)}</Text>,
        <Text>{cell(toolsText(r.tools), toolsW)}</Text>,
      ]
    }
    return [
      <Text color={COLORS.subagent}>{bars}</Text>,
      <Text color={COLORS.subagent}>{cell('↳', NUM)}</Text>,
      <Text>{cell('', TIME)}</Text>,
      <Text color={COLORS.subagent} underline>{cell(r.name, toolsW)}</Text>,
    ]
  }
}

// Rows of one conversation: requests are plain lines, a subagent is a Button that opens or closes it.
function conversationView(c: Ctx, rows: Row[], lead: string | null): El[] {
  const { Button, Text } = c.ui
  return rows.map((r, i) => {
    const mark = r.kind === 'subagent' ? marker(r.isOpen, r.count) : NO_MARK
    const scale = r.kind === 'request' ? c.scale : total(r.usage.tokens)
    const lines = viewLines(c, rowHead(c, r), r.usage, mark, scale)
    if (r.kind === 'request') return rowBox(c, r.key, i, lines.map((l) => <Text>{l}</Text>), lead)
    const press = () => c.actions.toggle(r.key, r.isOpen)
    return rowBox(c, r.key, i, lines.map((l, n) => (
      <Button key={n === 0 ? r.key : `${r.key}:more`} plain onPress={press}>{l}</Button>
    )), lead)
  })
}

// The column names over the rows, or the dashes under each of them. `head(w)` fills the leading columns in exactly
// w cells; `count` names the count column at the end.
function columnLine(c: Ctx, head: (w: number) => string, names: string[], count: string): El {
  const { Text } = c.ui
  const lead = ' '.repeat(ARROW)
  if (c.view === 'chart') {
    const headW = NUM + TIME + CHART_TOOLS
    const barW = Math.max(6, c.width - ARROW - headW - 2 * COL - MARK - 1)
    const [bar, ...rest] = names
    return <Text dimColor>{`${lead}${head(headW)}${cell(bar!, barW + 1)}${rest.map((n) => rcell(n, COL)).join('')}${rcell(count, MARK)}`}</Text>
  }
  const labelW = c.width - ARROW - FIGURES - MARK
  return <Text dimColor>{`${lead}${head(labelW)}${names.map((n) => rcell(n, COL)).join('')}${rcell(count, MARK)}`}</Text>
}

const NAMES = ['input', 'c.write', 'c.read', 'output', 'total']
const CHART_NAMES = ['bar', 'tokens', 'cost']

function headerLine(c: Ctx, head: (w: number) => string, count: string): El {
  return columnLine(c, head, c.view === 'chart' ? CHART_NAMES : NAMES, count)
}

// The dashes under each column, under the column names and over the totals. `head(w)` draws the leading ones.
function ruleLine(c: Ctx, head: (w: number) => string, count: string): El {
  const barW = Math.max(6, c.width - ARROW - NUM - TIME - CHART_TOOLS - 2 * COL - MARK - 1)
  const names = c.view === 'chart' ? [dashes(barW + 1), dashes(COL), dashes(COL)] : NAMES.map(() => dashes(COL))
  return columnLine(c, head, names, count === '' ? '' : dashes(MARK))
}

const requestHead = (w: number): string => `${cell('#', NUM)}${cell('time', TIME)}${cell('prompt / tools', w - NUM - TIME)}`
const requestRule = (w: number): string => `${cell(dashes(NUM), NUM)}${cell(dashes(TIME), TIME)}${cell(dashes(w - NUM - TIME), w - NUM - TIME)}`
const blank = (w: number): string => ' '.repeat(w)

function legend(c: Ctx): El {
  const { Text } = c.ui
  const names = ['input', 'c.write', 'c.read', 'output']
  return (
    <Text>
      {names.map((n, i) => <Text color={TOKEN_COLORS[i]}>{`█ ${n}${i < 3 ? '  ' : ''}`}</Text>)}
    </Text>
  )
}

// The largest request total fills the bar.
const scaleOf = (rows: Row[]): number => Math.max(1, ...rows.filter((r) => r.kind === 'request').map((r) => total(r.usage.tokens)))

function totalsView(c: Ctx, requests: Request[], windowTotals: WindowTotal[]): El[] {
  const { Box, Text } = c.ui
  const out: El[] = [ruleLine(c, requestRule, 'req')]
  const one = (key: string, usage: Usage, head: (w: number) => El[], background?: string) => {
    const lines = viewLines(c, head, usage, NO_MARK, total(usage.tokens))
    out.push(
      <Box key={`total:${key}`} flexDirection="column" backgroundColor={background}>
        {lines.map((l) => <Text>{l}</Text>)}
      </Box>,
    )
  }
  const usage = requests.length === 0 ? { tokens: ZERO_TOKENS, cost: ZERO_COSTS } : sumUsage(requests)
  one('conversation', usage, (w) => [<Text bold color={WHITE}>{cell('Conversation', w)}</Text>], BAND)
  for (const t of windowTotals) {
    const label = t.window.kind === 'five_hour'
      ? `5-hour window (${hhmm(t.window.end)})`
      : `7-day window (${weekday(t.window.end)})`
    one(t.window.kind, t.usage, (w) => [<Text color={COLORS.accent}>{cell(label, w)}</Text>])
  }
  return out
}

// A prompt line, a Button ending `▸ N` or `▾ N`, with its requests below it when open.
// `scale` fills the prompt's bar; `rowScale` the bars of its requests.
function promptView(c: Ctx, g: PromptGroup, scale: number, rowScale: number, lead: string | null, index: number): El {
  const { Box, Button, Text } = c.ui
  const press = () => c.actions.toggle(g.key, g.isOpen)
  const head = (w: number) => [
    <Text dimColor>{cell(g.at === null ? '' : String(g.number), NUM)}</Text>,
    <Text dimColor>{cell(g.at === null ? '' : hhmm(g.at), TIME)}</Text>,
    <Text bold color={WHITE}>{cell(g.text, w - NUM - TIME)}</Text>,
  ]
  const lines = viewLines(c, head, g.usage, marker(g.isOpen, g.count), scale).map((l, n) => (
    <Button key={n === 0 ? g.key : `${g.key}:more`} plain onPress={press}>{l}</Button>
  ))
  const inner = g.isOpen ? conversationView({ ...c, width: c.width - 2, scale: rowScale }, g.rows, `${lead ?? ''}│ `) : []
  return (
    <Box key={`row:${g.key}`} flexDirection="column" backgroundColor={index % 2 === 1 ? STRIPE : undefined}>
      {lead === null ? lines : lines.map((l) => (
        <Box>
          <Text dimColor>{lead}</Text>
          {l}
        </Box>
      ))}
      {inner}
    </Box>
  )
}

// The requests of a conversation under the prompts that started them; the requests alone when it has no prompts.
function requestsView(
  c: Ctx, conv: Conversation, p: PaneProps, prefix: string, range: [number, number] | undefined,
  isLastOpen: boolean, lead: string | null,
): El[] {
  const groups = promptGroups(conv, (k) => p.expanded[k], prefix, range, isLastOpen)
  if (groups === null) {
    const rows = conversationRows(conv, (k) => p.expanded[k] ?? false, prefix, range)
    return conversationView({ ...c, scale: scaleOf(rows) }, rows, lead)
  }
  const scale = Math.max(1, ...groups.map((g) => total(g.usage.tokens)))
  const rowScale = scaleOf(groups.flatMap((g) => g.rows))
  return groups.map((g, i) => promptView(c, g, scale, rowScale, lead, i))
}

function conversationTab(c: Ctx, p: PaneProps): El[] {
  const current = p.current
  return [
    ...(c.view === 'chart' ? [legend(c)] : []),
    headerLine(c, requestHead, 'req'),
    ruleLine(c, requestRule, 'req'),
    ...(current === null ? [] : requestsView(c, current, p, '', undefined, true, null)),
    ...totalsView(c, current?.requests ?? [], p.windowTotals),
  ]
}

// A group heading: a Button with the label and the totals, starting `▸` or `▾`.
function groupLine(c: Ctx, n: Node, labelColor: string): El[] {
  const { Button, Text } = c.ui
  const label = n.isNow ? `${n.label}  now` : n.label
  const head = (w: number) => [<Text bold color={labelColor}>{cell(label, w)}</Text>]
  const lines = viewLines(c, head, n.usage, marker(n.isOpen, n.count), total(n.usage.tokens))
  return lines.map((l, i) => (
    <Button key={i === 0 ? n.key : `${n.key}:more`} plain onPress={() => c.actions.toggle(n.key, n.isOpen)}>{l}</Button>
  ))
}

// A conversation on one row: its start time, its title and its totals. It opens to its prompts.
function conversationNode(c: Ctx, n: Node, p: PaneProps, index: number): El {
  const { Box, Button, Text } = c.ui
  const id = n.conversationId!
  const detail = p.details[id]
  const press = () => {
    c.actions.toggle(n.key, n.isOpen)
    if (!n.isOpen && !detail) c.actions.loadDetails(id)
  }
  const continued = n.isContinued ? '↳ ' : ''
  const head = (w: number) => [
    <Text dimColor>{cell(hhmm(n.startedAt ?? 0), TIME)}</Text>,
    <Text dimColor>{continued}</Text>,
    <Text color={WHITE}>{cell(n.label, w - TIME - continued.length)}</Text>,
  ]
  const lines = viewLines(c, head, n.usage, marker(n.isOpen, n.count), total(n.usage.tokens)).map((l, i) => (
    <Button key={i === 0 ? n.key : `${n.key}:more`} plain onPress={press}>{l}</Button>
  ))
  let inner: El[] = []
  if (n.isOpen) {
    if (!detail) inner = [<Text dimColor>Loading…</Text>]
    else {
      inner = requestsView({ ...c, width: c.width - 2 }, detail, p, `${n.key}/`, n.range ?? undefined, false, '│ ')
    }
  }
  return (
    <Box key={`row:${n.key}`} flexDirection="column" backgroundColor={index % 2 === 1 ? STRIPE : undefined}
      hover={c.isFullscreen ? HOVER : undefined}>
      {lines}
      {inner}
    </Box>
  )
}

// A group of groups is a heading on a darker band. A group of conversations is a heading in its own color with a
// dashed line under it while it is open. Every level starts at the left edge.
function nodeView(c: Ctx, n: Node, p: PaneProps, index: number): El {
  const { Box, Text } = c.ui
  if (n.kind === 'conversation') return conversationNode(c, n, p, index)
  const kids = n.isOpen ? n.children.map((k, i) => nodeView(c, k, p, i)) : []
  const holdsGroups = n.children.some((k) => k.kind !== 'conversation')
  if (holdsGroups) {
    return (
      <Box key={`group:${n.key}`} flexDirection="column">
        <Box flexDirection="column" backgroundColor={BAND}>
          {groupLine(c, n, n.color ?? (n.isNow ? COLORS.accent : WHITE))}
        </Box>
        {kids}
      </Box>
    )
  }
  return (
    <Box key={`group:${n.key}`} flexDirection="column">
      {groupLine(c, n, n.color ?? (n.isNow ? COLORS.accent : WHITE))}
      {n.isOpen ? <Text dimColor>{`${' '.repeat(ARROW)}${dashes(c.width - ARROW + 1)}`}</Text> : null}
      {kids}
    </Box>
  )
}

function historyTab(c: Ctx, p: PaneProps): El[] {
  const { Text } = c.ui
  const data = p.history
  if (data === null) return [<Text dimColor>Loading…</Text>]
  if ('error' in data) return [<Text color="error">{data.error}</Text>]
  if (data.conversations.length === 0) return [<Text dimColor>No stored conversations yet.</Text>]
  const nodes = historyTree(data, p.grouping, p.now, p.expanded)
  return [
    ...(c.view === 'chart' ? [legend(c)] : []),
    headerLine(c, blank, ''),
    ruleLine(c, blank, ''),
    ...nodes.map((n, i) => nodeView(c, n, p, i)),
  ]
}

// One row per model, in USD per million tokens, then, under a dashed line, the factors some requests are charged.
function pricesTab(c: Ctx): El[] {
  const { Box, Text } = c.ui
  const modelW = c.width - 5 * PRICE_COL
  const names = ['input', 'write 5m', 'write 1h', 'read', 'output'].map((n) => rcell(n, PRICE_COL)).join('')
  const rows = Object.entries(PRICES).map(([model, p], i) => (
    <Box key={`price:${model}`} backgroundColor={i % 2 === 1 ? STRIPE : undefined}>
      <Text color={WHITE}>{cell(model, modelW)}</Text>
      {[p.input, p.input * CACHE_WRITE_5M, p.input * CACHE_WRITE_1H, p.cacheRead, p.output].map((v) => (
        <Text color={COLORS.cost}>{rcell(fmtPrice(v), PRICE_COL)}</Text>
      ))}
    </Box>
  ))
  const rule = <Text dimColor>{`${cell(dashes(modelW), modelW)}${rcell(dashes(PRICE_COL), PRICE_COL).repeat(5)}`}</Text>
  return [
    <Text dimColor>{`${cell('USD per million tokens', modelW)}${names}`}</Text>,
    rule,
    ...rows,
    rule,
    ...[
      `A cache write costs ${CACHE_WRITE_5M} x input for 5 minutes, ${CACHE_WRITE_1H} x input for 1 hour.`,
      `Fast mode on ${FAST_MODELS.join(' and ')}: every price x ${FAST_FACTOR}.`,
      `${LONG_CONTEXT_MODEL} with more than ${LONG_CONTEXT_TOKENS.toLocaleString('en-US')} input tokens in one request: every price x ${LONG_CONTEXT_FACTOR}.`,
      'A model missing from this table has no cost, shown as ?.',
    ].map((note) => (
      <Box key={note}>
        <Text dimColor>{'• '}</Text>
        <Box width={c.width - 2}><Text dimColor wrap="wrap">{note}</Text></Box>
      </Box>
    )),
  ]
}

// A row of switch choices: the current one is bold and inverse; `key` presses the next one.
function switchView<T extends string>(c: Ctx, id: string, choices: [T, string][], current: T, select: (t: T) => void): El {
  const { Box, Button, Text } = c.ui
  return (
    <Box gap={1}>
      {choices.map(([value, label]) => (
        <Button key={`${id}-${value}`} plain onPress={() => select(value)}>
          {value === current
            ? <Text bold color="inverseText" backgroundColor={ACCENT}>{` ${label} `}</Text>
            : <Text dimColor>{` ${label} `}</Text>}
        </Button>
      ))}
    </Box>
  )
}

// The rows the pane keeps at the bottom: the view switch on the left and the grouping switch on the right, then the
// keys of the tab on show, each under a line. The pane has no footer of its own, so these rows move with the scroll.
const footerRows = (tab: Tab): number => (tab === 'prices' ? 2 : 4)

function footer(c: Ctx, p: PaneProps): El {
  const { Box, Button, Text } = c.ui
  const keys: [string, string, string, () => void][] = [
    ['tab-next', 't', 'Tab', c.actions.nextTab],
    ...(p.tab === 'prices' ? [] : [['view-next', 'v', 'View', c.actions.nextView] as [string, string, string, () => void]]),
    ...(p.tab === 'history' ? [['group-next', 'g', 'Group', c.actions.nextGrouping] as [string, string, string, () => void]] : []),
    ['hide', 'h', 'Hide', c.actions.hide],
  ]
  const used = keys.reduce((n, [, hotkey, label]) => n + hotkey.length + label.length + 4, 0)
  const line = <Text dimColor>{'─'.repeat(p.width)}</Text>
  return (
    <Box position="absolute" top={p.scroll.offset + p.scroll.bodyRows - footerRows(p.tab)} left={0} width={p.width} flexDirection="column">
      {p.tab === 'prices' ? null : [
        line,
        <Box key="switches" width={p.width} justifyContent="space-between">
          {switchView(c, 'view', VIEWS, p.view, c.actions.selectView)}
          {p.tab === 'history' ? switchView(c, 'group', GROUPINGS, p.grouping, c.actions.selectGrouping) : null}
        </Box>,
      ]}
      {line}
      <Box>
        {keys.map(([key, hotkey, label, press]) => [
          <Button key={key} plain hotkey={hotkey} dimColor onPress={press}>{label}</Button>,
          <Text key={`${key}-gap`}>{'  '}</Text>,
        ])}
        <Text>{' '.repeat(Math.max(0, p.width - used))}</Text>
      </Box>
    </Box>
  )
}

export function drawPane(ui: Ui, p: PaneProps, actions: Actions): El {
  const { Box, Button, Text } = ui
  const c: Ctx = { ui, view: p.view, width: p.width, isFullscreen: p.isFullscreen, scale: 1, actions }
  const tabs: [Tab, string][] = [['conversation', 'Conversation'], ['history', 'History'], ['prices', 'Prices']]
  return (
    <Box flexDirection="column" width={p.width} minHeight={p.scroll.bodyRows} paddingBottom={footerRows(p.tab)}>
      <Text dimColor>{'─'.repeat(p.width)}</Text>
      {switchView(c, 'tab', tabs, p.tab, actions.selectTab)}
      <Text dimColor>{'─'.repeat(p.width)}</Text>
      {p.notice === null ? null : <Text dimColor>{p.notice}</Text>}
      {p.tab === 'conversation' ? conversationTab(c, p) : p.tab === 'history' ? historyTab(c, p) : pricesTab(c)}
      {footer(c, p)}
    </Box>
  )
}
