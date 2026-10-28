import type { Prompt, Request, Tokens } from '../types'

const TITLE_LENGTH = 100
const PROMPT_LENGTH = 200

type Json = Record<string, any>

export type TranscriptState = {
  agentId: string | null
  requests: Map<string, Request>
  customTitle: string | null
  aiTitle: string | null
  firstPrompt: string | null
  prompts: Prompt[]
  cwd: string | null
  startedAt: number | null
}

export const newTranscript = (agentId: string | null): TranscriptState => ({
  agentId,
  requests: new Map(),
  customTitle: null,
  aiTitle: null,
  firstPrompt: null,
  prompts: [],
  cwd: null,
  startedAt: null,
})

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

const tokensOf = (usage: Json): Tokens => {
  const split = usage.cache_creation
  const hasSplit = split !== null && typeof split === 'object'
  return {
    input: num(usage.input_tokens),
    cacheWrite5m: hasSplit ? num(split.ephemeral_5m_input_tokens) : num(usage.cache_creation_input_tokens),
    cacheWrite1h: hasSplit ? num(split.ephemeral_1h_input_tokens) : 0,
    cacheRead: num(usage.cache_read_input_tokens),
    output: num(usage.output_tokens),
  }
}

const textOf = (line: Json): string | null => {
  if (line.isMeta === true || line.isCompactSummary === true) return null
  const content = line.message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  const block = content.find((b: Json) => b?.type === 'text' && typeof b.text === 'string')
  return block ? block.text : null
}

// The text the person typed; null for meta, command, tool result and interruption lines.
const promptOf = (line: Json): string | null => {
  const text = textOf(line)
  if (text === null || text.trim() === '') return null
  const start = text.trimStart()
  if (start.startsWith('<') || start.startsWith('[Request interrupted')) return null
  return text
}

const COMMAND = /^\s*<command-name>([^<]*)<\/command-name>/
const ARGS = /<command-args>([^<]*)<\/command-args>/

// A slash command as typed, `/name args`; null for any other line.
const commandOf = (line: Json): string | null => {
  const text = textOf(line)
  const name = text === null ? undefined : COMMAND.exec(text)?.[1]?.trim()
  if (!name) return null
  const args = ARGS.exec(text!)?.[1]?.trim()
  return args ? `${name} ${args}` : name
}

const firstLine = (text: string, length: number): string => (text.trim().split('\n')[0] ?? '').slice(0, length)

const addRequest = (state: TranscriptState, line: Json, at: number): void => {
  const message = line.message
  if (typeof message?.id !== 'string' || typeof line.requestId !== 'string') return
  if (!message.usage || typeof message.usage !== 'object') return
  if (typeof message.model !== 'string' || message.model === '<synthetic>') return

  const key = `${message.id}|${line.requestId}`
  let request = state.requests.get(key)
  const tokens = tokensOf(message.usage)
  if (!request) {
    request = {
      messageId: message.id,
      requestId: line.requestId,
      agentId: state.agentId,
      at,
      model: message.model,
      isFast: message.usage.speed === 'fast',
      tokens,
      tools: [],
      toolUseIds: [],
    }
    state.requests.set(key, request)
  } else if (tokens.output > request.tokens.output) {
    request.tokens = { ...request.tokens, output: tokens.output }
  }

  if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (block?.type !== 'tool_use') continue
      if (typeof block.name === 'string' && !request.tools.includes(block.name)) request.tools.push(block.name)
      if (typeof block.id === 'string' && !request.toolUseIds.includes(block.id)) request.toolUseIds.push(block.id)
    }
  }
}

export const feed = (state: TranscriptState, lines: string[]): void => {
  for (const raw of lines) {
    if (raw.trim() === '') continue
    let line: Json
    try {
      line = JSON.parse(raw)
    } catch {
      continue
    }
    if (line === null || typeof line !== 'object') continue

    const at = typeof line.timestamp === 'string' ? Date.parse(line.timestamp) : NaN
    if (state.startedAt === null && Number.isFinite(at)) state.startedAt = at
    if (state.cwd === null && typeof line.cwd === 'string' && line.cwd !== '') state.cwd = line.cwd

    if (line.type === 'assistant') addRequest(state, line, Number.isFinite(at) ? at : 0)
    else if (line.type === 'custom-title' && typeof line.customTitle === 'string') state.customTitle = line.customTitle
    else if (line.type === 'ai-title' && typeof line.aiTitle === 'string') state.aiTitle = line.aiTitle
    else if (line.type === 'user') {
      const text = promptOf(line)
      if (text !== null && state.firstPrompt === null) state.firstPrompt = firstLine(text, TITLE_LENGTH)
      const typed = text ?? commandOf(line)
      if (typed !== null && state.agentId === null && Number.isFinite(at)) {
        state.prompts.push({ at, text: firstLine(typed, PROMPT_LENGTH) })
      }
    }
  }
}

export const requestsOf = (state: TranscriptState): Request[] => [...state.requests.values()]

export const promptsOf = (state: TranscriptState): Prompt[] => [...state.prompts]

export const titleOf = (state: TranscriptState): string | null => state.customTitle ?? state.aiTitle ?? state.firstPrompt

export const cwdOf = (state: TranscriptState): string | null => state.cwd

export const startedOf = (state: TranscriptState): number | null => state.startedAt

export const completeLines = (chunk: string): { lines: string[]; rest: string } => {
  const end = chunk.lastIndexOf('\n')
  if (end < 0) return { lines: [], rest: chunk }
  return { lines: chunk.slice(0, end).split('\n'), rest: chunk.slice(end + 1) }
}

export const utf8Length = (text: string): number => {
  let bytes = 0
  for (const char of text) {
    const code = char.codePointAt(0)!
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}
