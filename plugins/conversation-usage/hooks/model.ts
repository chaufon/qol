import type { Conversation, Grouping, HistoryConversation, HistoryData, Request, Subagent, Usage, Window } from '../types'
import { dayLabel, hhmm, projectColor, projectLabel, weekday } from './format'
import { addCosts, addTokens, costOf, ZERO_TOKENS } from './prices'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const EMPTY: Usage = { tokens: ZERO_TOKENS, cost: null }

const addUsage = (a: Usage, b: Usage): Usage => ({ tokens: addTokens(a.tokens, b.tokens), cost: addCosts(a.cost, b.cost) })

// Requests with an unknown model add tokens but no cost; the cost is null when no request has a known price.
export const sumUsage = (rs: Request[]): Usage =>
  rs.reduce<Usage>((acc, r) => ({ tokens: addTokens(acc.tokens, r.tokens), cost: addCosts(acc.cost, costOf(r)) }), EMPTY)

export type Row =
  | { kind: 'request'; key: string; number: number; depth: number; at: number; tools: string[]; usage: Usage }
  | { kind: 'subagent'; key: string; agentId: string; name: string; depth: number; count: number; isOpen: boolean; usage: Usage }

// The rows of one conversation: its main requests, each followed by the subagents it launched.
// An open subagent lists its own requests one level deeper.
export const conversationRows = (
  c: Conversation,
  isOpen: (key: string) => boolean,
  prefix: string,
  range?: [number, number],
): Row[] => {
  const inRange = (r: Request) => !range || (range[0] <= r.at && r.at < range[1])
  const requestsOf = (agentId: string | null) =>
    c.requests.filter((r) => r.agentId === agentId && inRange(r)).sort((a, b) => a.at - b.at)
  const children = (agentId: string | null) =>
    c.subagents.filter((s) => s.parentAgentId === agentId && (!range || requestsOf(s.agentId).length > 0 || hasKids(s.agentId)))
  const hasKids = (agentId: string): boolean =>
    c.subagents.some((s) => s.parentAgentId === agentId && (requestsOf(s.agentId).length > 0 || hasKids(s.agentId)))

  const rows: Row[] = []
  const subRows = (s: Subagent, depth: number) => {
    const rs = requestsOf(s.agentId)
    const key = `${prefix}sub:${s.agentId}`
    const open = isOpen(key)
    rows.push({ kind: 'subagent', key, agentId: s.agentId, name: s.name, depth, count: rs.length, isOpen: open, usage: sumUsage(rs) })
    if (open) context(s.agentId, depth + 1)
  }
  const context = (agentId: string | null, depth: number) => {
    const placed = new Set<string>()
    const kids = children(agentId)
    requestsOf(agentId).forEach((r, i) => {
      rows.push({
        kind: 'request', key: `${prefix}req:${r.messageId}|${r.requestId}`, number: i + 1, depth, at: r.at,
        tools: r.tools, usage: sumUsage([r]),
      })
      for (const id of r.toolUseIds) {
        for (const s of kids) {
          if (s.toolUseId === id && !placed.has(s.agentId)) {
            placed.add(s.agentId)
            subRows(s, depth)
          }
        }
      }
    })
    for (const s of kids) if (!placed.has(s.agentId)) subRows(s, depth)
  }
  context(null, 0)
  return rows
}

export type PromptGroup = {
  key: string; number: number; at: number | null; text: string; count: number; isOpen: boolean; usage: Usage; rows: Row[]
}

// The requests of a conversation grouped by the prompt that started them; null when it has no prompts.
// A main request belongs to the last prompt at or before it. A subagent belongs to the group of the request
// that launched it, else to its parent's group, else to the group of its first request's time. Requests
// before the first prompt form group 0. Prompts that made no request, such as /clear, have no group, and
// `number` counts only the prompts that made a request. `isOpen` answers undefined for a key never toggled: the last group
// is then open when `isLastOpen` is set.
export const promptGroups = (
  c: Conversation,
  isOpen: (key: string) => boolean | undefined,
  prefix: string,
  range: [number, number] | undefined,
  isLastOpen: boolean,
): PromptGroup[] | null => {
  const prompts = [...(c.prompts ?? [])].sort((a, b) => a.at - b.at)
  if (prompts.length === 0) return null
  const groupAt = (at: number): number => {
    let g = 0
    prompts.forEach((p, i) => { if (p.at <= at) g = i + 1 })
    return g
  }
  const groupOfRequest = new Map<Request, number>()
  const launcher = new Map<string, number>()
  for (const r of c.requests) {
    if (r.agentId !== null) continue
    const g = groupAt(r.at)
    groupOfRequest.set(r, g)
    for (const id of r.toolUseIds) launcher.set(id, g)
  }
  const firstAt = (agentId: string): number => Math.min(...c.requests.filter((r) => r.agentId === agentId).map((r) => r.at))
  const agentGroup = new Map<string, number>()
  const groupOfAgent = (s: Subagent, seen: Set<string> = new Set()): number => {
    const known = agentGroup.get(s.agentId)
    if (known !== undefined) return known
    let g: number | undefined = s.toolUseId === null ? undefined : launcher.get(s.toolUseId)
    const parent = c.subagents.find((p) => p.agentId === s.parentAgentId)
    if (g === undefined && parent && !seen.has(parent.agentId)) g = groupOfAgent(parent, seen.add(s.agentId))
    if (g === undefined) {
      const at = firstAt(s.agentId)
      g = Number.isFinite(at) ? groupAt(at) : prompts.length
    }
    agentGroup.set(s.agentId, g)
    return g
  }
  for (const s of c.subagents) groupOfAgent(s)
  for (const r of c.requests) if (r.agentId !== null) groupOfRequest.set(r, agentGroup.get(r.agentId) ?? groupAt(r.at))

  const inRange = (r: Request) => !range || (range[0] <= r.at && r.at < range[1])
  const groups: PromptGroup[] = []
  let number = 0
  for (let g = 0; g <= prompts.length; g++) {
    const requests = c.requests.filter((r) => groupOfRequest.get(r) === g)
    if (g > 0 && requests.length > 0) number++
    const shown = requests.filter(inRange)
    if (shown.length === 0) continue
    const part: Conversation = { ...c, requests, subagents: c.subagents.filter((s) => agentGroup.get(s.agentId) === g) }
    const key = `${prefix}prompt:${g}`
    const prompt = g === 0 ? null : prompts[g - 1]!
    groups.push({
      key, number: g === 0 ? 0 : number, at: prompt?.at ?? null, text: prompt?.text ?? 'Before the first prompt', count: shown.length,
      isOpen: false, usage: sumUsage(shown), rows: conversationRows(part, (k) => isOpen(k) ?? false, prefix, range),
    })
  }
  groups.forEach((group, i) => {
    group.isOpen = isOpen(group.key) ?? (isLastOpen && i === groups.length - 1)
  })
  return groups
}

export type Node = {
  key: string
  kind: 'day' | 'project' | 'week' | 'fiveHour' | 'conversation'
  label: string
  usage: Usage
  count: number
  isOpen: boolean
  color: string | null
  isNow: boolean
  isContinued: boolean
  conversationId: string | null
  range: [number, number] | null
  startedAt: number | null
  children: Node[]
}

const pad = (n: number): string => String(n).padStart(2, '0')

const dayKey = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const dateText = (ms: number): string => `${weekday(ms)} ${new Date(ms).getDate()} ${MONTHS[new Date(ms).getMonth()]}`

// Groups items by a string key, keeping the order in which keys first appear.
const groupBy = <T>(items: T[], keyOf: (t: T) => string): Map<string, T[]> => {
  const out = new Map<string, T[]>()
  for (const item of items) {
    const k = keyOf(item)
    const list = out.get(k)
    if (list) list.push(item)
    else out.set(k, [item])
  }
  return out
}

const latest = (cs: HistoryConversation[]): number => Math.max(...cs.map((c) => c.startedAt))

export const historyTree = (
  h: HistoryData,
  grouping: Grouping,
  now: number,
  expanded: Record<string, boolean>,
): Node[] => {
  // fresh: inside the first top-level node, where groups default to open.
  const group = (
    key: string, kind: Node['kind'], label: string, fresh: boolean, children: Node[],
    extra: Partial<Node> = {},
  ): Node => ({
    key, kind, label, usage: children.reduce((u, c) => addUsage(u, c.usage), EMPTY), count: children.length,
    isOpen: expanded[key] ?? fresh, color: null, isNow: false, isContinued: false, conversationId: null,
    range: null, startedAt: null, children, ...extra,
  })
  const convNode = (
    key: string, c: HistoryConversation, usage: Usage, count: number, extra: Partial<Node> = {},
  ): Node => ({
    key, kind: 'conversation', label: c.title, usage, count, isOpen: expanded[key] ?? false, color: null,
    isNow: false, isContinued: false, conversationId: c.id, range: null, startedAt: c.startedAt, children: [],
    ...extra,
  })
  const newestFirst = (cs: HistoryConversation[]) => [...cs].sort((a, b) => b.startedAt - a.startedAt)
  const leaves = (parent: string, cs: HistoryConversation[]) =>
    newestFirst(cs).map((c) => convNode(`${parent}/conv:${c.id}`, c, c.usage, c.requestCount))
  const byLatest = <T>(m: Map<string, HistoryConversation[]>, build: (k: string, cs: HistoryConversation[]) => T): T[] =>
    [...m.entries()].sort((a, b) => latest(b[1]) - latest(a[1])).map(([k, cs]) => build(k, cs))

  const dayNodes = (parent: string, cs: HistoryConversation[], fresh: boolean): Node[] =>
    byLatest(groupBy(cs, (c) => dayKey(c.startedAt)), (k, list) =>
      group(`${parent}day:${k}`, 'day', dayLabel(latest(list), now), fresh,
        leaves(`${parent}day:${k}`, list)))
  const projectNodes = (parent: string, cs: HistoryConversation[], fresh: boolean, inner: boolean): Node[] =>
    byLatest(groupBy(cs, (c) => c.project), (path, list) => {
      const key = `${parent}project:${path}`
      const kids = inner ? dayNodes(`${key}/`, list, fresh) : leaves(key, list)
      return group(key, 'project', projectLabel(path), fresh, kids, { color: projectColor(path) })
    })

  // The first top-level node is open together with its groups; build it fresh, the rest closed.
  const openFirst = (build: (fresh: boolean) => Node[]): Node[] => {
    const first = build(true)
    const rest = build(false)
    return first.slice(0, 1).concat(rest.slice(1))
  }

  if (grouping === 'date') {
    return openFirst((fresh) =>
      byLatest(groupBy(h.conversations, (c) => dayKey(c.startedAt)), (k, list) => {
        const key = `day:${k}`
        return group(key, 'day', dayLabel(latest(list), now), fresh, projectNodes(`${key}/`, list, fresh, false))
      }),
    )
  }
  if (grouping === 'project') return openFirst((fresh) => projectNodes('', h.conversations, fresh, true))

  const byId = new Map(h.conversations.map((c) => [c.id, c]))
  const isNow = (w: Window) => w.start <= now && now < w.end
  const sorted = (kind: Window['kind']) => h.windows.filter((w) => w.kind === kind).sort((a, b) => b.start - a.start)
  const fiveHourNode = (parent: string, w: Window, fresh: boolean): Node => {
    const key = `${parent}fiveHour:${w.start}`
    const kids: Node[] = []
    for (const s of h.slices) {
      const c = byId.get(s.conversationId)
      if (s.kind !== 'five_hour' || s.windowStart !== w.start || !c) continue
      kids.push(convNode(`${key}/conv:${c.id}`, c, s.usage, s.requestCount, {
        range: [w.start, w.end], isContinued: c.startedAt < w.start,
      }))
    }
    kids.sort((a, b) => b.startedAt! - a.startedAt!)
    return group(key, 'fiveHour', `5-hour · ${hhmm(w.start)}–${hhmm(w.end)}`, fresh, kids, { isNow: isNow(w) })
  }
  const weeks = sorted('seven_day')
  const fives = sorted('five_hour')
  const inWeek = (f: Window, w: Window) => w.start <= f.start && f.start < w.end
  const build = (fresh: boolean): Node[] => {
    const nodes: Node[] = weeks.map((w, i) => {
      const key = `week:${w.start}`
      const open = fresh && i === 0
      const fiveHours = fives.filter((f) => inWeek(f, w)).map((f) => fiveHourNode(`${key}/`, f, open))
      const usage = h.slices
        .filter((s) => s.kind === 'seven_day' && s.windowStart === w.start)
        .reduce((u, s) => addUsage(u, s.usage), EMPTY)
      return group(key, 'week', `7-day window · ${dateText(w.start)} → ${dateText(w.end)}`, open, fiveHours, { isNow: isNow(w), usage })
    })
    for (const f of fives) if (!weeks.some((w) => inWeek(f, w))) nodes.push(fiveHourNode('', f, fresh && nodes.length === 0))
    return nodes
  }
  return build(true)
}
