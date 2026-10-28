export type Tokens = { input: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number; output: number }
export type Costs = { input: number; cacheWrite: number; cacheRead: number; output: number; total: number }
// cost is null when no request inside has a known price.
export type Usage = { tokens: Tokens; cost: Costs | null }

// One API request: the (messageId, requestId) pair. at = epoch ms of its first transcript line.
export type Request = {
  messageId: string; requestId: string; agentId: string | null; at: number; model: string; isFast: boolean
  tokens: Tokens; tools: string[]; toolUseIds: string[]
}
// name: meta description, else agentType. toolUseId: the Agent tool call that launched it.
export type Subagent = { agentId: string; parentAgentId: string | null; name: string; toolUseId: string | null }
// A prompt of the person, or a slash command, in the main transcript. text = its first line.
export type Prompt = { at: number; text: string }
export type Conversation = {
  id: string; project: string; title: string; startedAt: number; requests: Request[]; subagents: Subagent[]
  prompts: Prompt[]
}

export type WindowKind = 'five_hour' | 'seven_day'
export type Window = { kind: WindowKind; start: number; end: number; percentUsed: number }
export type WindowTotal = { window: Window; usage: Usage }

export type Tab = 'conversation' | 'history' | 'prices'
export type View = 'tokens' | 'cost' | 'both' | 'chart'
export type Grouping = 'date' | 'project' | 'window'

export type HistoryConversation = {
  id: string; project: string; title: string; startedAt: number; usage: Usage; requestCount: number
}
// The part of one conversation that falls inside one stored window.
export type HistorySlice = {
  kind: WindowKind; windowStart: number; conversationId: string; usage: Usage; requestCount: number; firstAt: number
}
export type HistoryData = { conversations: HistoryConversation[]; windows: Window[]; slices: HistorySlice[] }
export type History = HistoryData | { error: string } | null

declare module 'claude-code' {
  interface PluginState {
    'conversation-usage': {
      isOpen: boolean; tab: Tab; view: View; grouping: Grouping
      expanded: Record<string, boolean>          // row/group key → open; absent = its default
      current: Conversation | null               // the current conversation, read from its transcript
      windowTotals: WindowTotal[]                 // the current 5-hour and 7-day windows, from the database
      history: History
      details: Record<string, Conversation>       // History conversations loaded on expand, by id
      notice: string | null                       // one line, e.g. sqlite3 missing
      now: number                                 // epoch ms of the last refresh, for Today/Yesterday labels
    }
  }
}
