import type { EngineInterface } from 'claude-code'

import type { Conversation, Request, Subagent } from '../types'
import { completeLines, cwdOf, feed, newTranscript, promptsOf, requestsOf, startedOf, titleOf, utf8Length } from './transcript'
import type { TranscriptState } from './transcript'

type Cursor = { offset: number; state: TranscriptState }
type Known = Cursor & { name: string; toolUseId: string | null }

export type Reader = {
  conversationId: string | null
  path: string | null
  main: Cursor
  subagents: Map<string, Known>
}

export const newReader = (): Reader => ({
  conversationId: null,
  path: null,
  main: { offset: 0, state: newTranscript(null) },
  subagents: new Map(),
})

export async function configDir($: EngineInterface): Promise<string> {
  const set = await $.env.get('CLAUDE_CONFIG_DIR')
  if (set) return set
  return `${(await $.env.get('HOME')) ?? ''}/.claude`
}

// Runs a command; null when it exits non-zero or rejects.
async function run($: EngineInterface, argv: string[]) {
  try {
    const result = await $.process.run(argv)
    return result.exitCode === 0 ? result : null
  } catch {
    return null
  }
}

const lines = (stdout: string): string[] => stdout.split('\n').filter((line) => line !== '')

// Feeds the bytes appended to `path` since the cursor into its state. False when a read failed.
async function advance($: EngineInterface, path: string, cursor: Cursor): Promise<boolean> {
  for (;;) {
    const result = await run($, ['tail', '-c', `+${cursor.offset + 1}`, path])
    if (result === null) return false
    const { lines: complete } = completeLines(result.stdout)
    if (complete.length > 0) {
      feed(cursor.state, complete)
      cursor.offset += utf8Length(complete.join('\n') + '\n')
    }
    if (!result.isStdoutTruncated) return true
    if (complete.length > 0) continue
    // The read holds no complete line: one line is longer than the read limit. Such a line carries
    // no usage, so the cursor moves past it. A line still being written is retried on the next call.
    const size = await lineAt($, path, cursor.offset)
    if (size === null) return false
    if (size === 0) return true
    cursor.offset += size
  }
}

// Bytes of the line starting at `offset`, newline included; 0 when that line has no newline yet.
// Null when the measuring command fails.
async function lineAt($: EngineInterface, path: string, offset: number): Promise<number | null> {
  const script = 'tail -c +"$1" "$2" | head -n 1 | wc -lc'
  const result = await run($, ['sh', '-c', script, 'sh', String(offset + 1), path])
  if (result === null) return null
  const [newlines, size] = result.stdout.trim().split(/\s+/).map(Number)
  if (newlines === undefined || size === undefined || Number.isNaN(newlines) || Number.isNaN(size)) return null
  return newlines > 0 ? size : 0
}

async function locate($: EngineInterface, conversationId: string): Promise<string | null> {
  const root = `${await configDir($)}/projects`
  const result = await run($, ['find', root, '-maxdepth', '2', '-name', `${conversationId}.jsonl`])
  return result === null ? null : (lines(result.stdout)[0] ?? null)
}

const META = /\/agent-([^/]+)\.meta\.json$/

async function syncSubagents($: EngineInterface, reader: Reader, dir: string): Promise<void> {
  const found = await run($, ['find', dir, '-maxdepth', '1', '-name', 'agent-*.meta.json'])
  if (found !== null) {
    for (const file of lines(found.stdout)) {
      const agentId = META.exec(file)?.[1]
      if (agentId === undefined || reader.subagents.has(agentId)) continue
      const content = await run($, ['cat', file])
      if (content === null) continue
      let meta: Record<string, unknown>
      try {
        meta = JSON.parse(content.stdout)
      } catch {
        continue
      }
      if (meta === null || typeof meta !== 'object') continue
      const name = [meta.description, meta.agentType].find((v) => typeof v === 'string' && v !== '') as string | undefined
      reader.subagents.set(agentId, {
        offset: 0,
        state: newTranscript(agentId),
        name: name ?? agentId,
        toolUseId: typeof meta.toolUseId === 'string' ? meta.toolUseId : null,
      })
    }
  }
  for (const [agentId, known] of reader.subagents) await advance($, `${dir}/agent-${agentId}.jsonl`, known)
}

export async function readConversation(
  $: EngineInterface,
  reader: Reader,
  conversationId: string,
): Promise<Conversation | null> {
  if (reader.conversationId !== conversationId) Object.assign(reader, newReader(), { conversationId })

  if (reader.path === null) {
    reader.path = await locate($, conversationId)
    if (reader.path === null) return null
  }
  if (!(await advance($, reader.path, reader.main))) return null

  const folder = reader.path.slice(0, reader.path.lastIndexOf('/'))
  await syncSubagents($, reader, `${folder}/${conversationId}/subagents`)

  const requests: Request[] = requestsOf(reader.main.state)
  const holders = new Map<string, string | null>()
  for (const request of requests) for (const id of request.toolUseIds) holders.set(id, null)
  const subagents: Subagent[] = []
  for (const [agentId, known] of reader.subagents) {
    const own = requestsOf(known.state)
    requests.push(...own)
    for (const request of own) for (const id of request.toolUseIds) holders.set(id, agentId)
    subagents.push({ agentId, parentAgentId: null, name: known.name, toolUseId: known.toolUseId })
  }
  for (const subagent of subagents) {
    if (subagent.toolUseId !== null) subagent.parentAgentId = holders.get(subagent.toolUseId) ?? null
  }

  const state = reader.main.state
  return {
    id: conversationId,
    project: cwdOf(state) ?? (await $.session.cwd()),
    title: titleOf(state) ?? '',
    startedAt: startedOf(state) ?? requests[0]?.at ?? 0,
    requests,
    subagents,
    prompts: promptsOf(state),
  }
}
