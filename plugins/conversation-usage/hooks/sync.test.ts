import { expect, test } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'

import type { Conversation } from '../types'
import { configDir, newReader, readConversation } from './sync'
import type { Reader } from './sync'

const ROOT = '/home/u/.claude'
const DIR = `${ROOT}/projects/-work-app`

const bytes = (text: string) => new TextEncoder().encode(text)

type Fake = {
  $: EngineInterface
  files: Map<string, string>
  limit: number
  env: Record<string, string>
  runs: string[][]
  read: (reader: Reader, id: string) => Promise<Conversation | null>
  config: () => Promise<string>
}

const globToRegExp = (glob: string) => new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)

// An in-memory disk behind the `$` calls the module makes: env.get, session.cwd and process.run
// (find, cat and tail -c +N, byte-accurate and cut to `limit` bytes).
function fakeDisk(): Fake {
  const fake = { files: new Map<string, string>(), limit: Infinity, env: { HOME: '/home/u' } as Record<string, string>, runs: [] as string[][] } as Fake
  const out = (stdout: string, exitCode = 0, isStdoutTruncated = false) => ({
    exitCode, stdout, stderr: '', isStdoutTruncated, isStderrTruncated: false,
  })
  const run = async (argv: readonly string[]) => {
    fake.runs.push([...argv])
    if (argv[0] === 'find') {
      const dir = argv[1]!
      const depth = Number(argv[3])
      const name = globToRegExp(argv[5]!)
      const hits = [...fake.files.keys()].filter((path) => {
        if (!path.startsWith(`${dir}/`)) return false
        const parts = path.slice(dir.length + 1).split('/')
        return parts.length <= depth && name.test(parts[parts.length - 1]!)
      })
      return out(hits.map((p) => `${p}\n`).join(''), hits.length > 0 ? 0 : 1)
    }
    if (argv[0] === 'cat') {
      const content = fake.files.get(argv[1]!)
      return content === undefined ? out('', 1) : out(content)
    }
    if (argv[0] === 'tail') {
      const content = fake.files.get(argv[3]!)
      if (content === undefined) return out('', 1)
      const all = bytes(content).slice(Number(argv[2]!.slice(1)) - 1)
      const cut = all.length > fake.limit
      const part = new TextDecoder().decode(all.slice(0, fake.limit))
      return out(cut ? part.replace(/\uFFFD$/, '') : part, 0, cut)
    }
    if (argv[0] === 'sh') {
      // tail -c +N <path> | head -n 1 | wc -lc
      const content = fake.files.get(argv[5]!)
      if (content === undefined) return out('', 1)
      const rest = bytes(content).slice(Number(argv[4]) - 1)
      const newline = rest.indexOf(10)
      const size = newline === -1 ? rest.length : newline + 1
      return out(`${newline === -1 ? 0 : 1} ${size}\n`)
    }
    throw new Error(`unexpected ${argv.join(' ')}`)
  }
  fake.$ = {
    env: { get: async (name: string) => fake.env[name] },
    session: { cwd: async () => '/fallback' },
    process: { run },
  } as unknown as EngineInterface
  fake.read = (reader, id) => readConversation(fake.$, reader, id)
  fake.config = () => configDir(fake.$)
  return fake
}

const assistant = (id: string, at: string, text: string, tools: string[] = []) =>
  JSON.stringify({
    type: 'assistant',
    requestId: `req_${id}`,
    timestamp: at,
    cwd: '/work/app',
    message: {
      id: `msg_${id}`,
      model: 'claude-opus-5',
      usage: { input_tokens: 1, output_tokens: 2 },
      content: [{ type: 'text', text }, ...tools.map((t) => ({ type: 'tool_use', id: t, name: 'Agent' }))],
    },
  }) + '\n'

const prompt = (text: string) =>
  JSON.stringify({ type: 'user', timestamp: '2026-10-28T09:59:00.000Z', message: { role: 'user', content: text } }) + '\n'

const MAIN = `${DIR}/c1.jsonl`
const META = (id: string) => `${DIR}/c1/subagents/agent-${id}.meta.json`
const SUB = (id: string) => `${DIR}/c1/subagents/agent-${id}.jsonl`

const mainFile = () =>
  prompt('Hello there') +
  assistant('1', '2026-10-28T10:00:00.000Z', 'a', ['toolu_1']) +
  assistant('2', '2026-10-28T10:01:00.000Z', 'b')

test('configDir uses CLAUDE_CONFIG_DIR, else HOME/.claude', async () => {
  const fake = fakeDisk()
  const { config } = fake
  expect(await config()).toBe('/home/u/.claude')
  fake.env.CLAUDE_CONFIG_DIR = '/cfg'
  expect(await config()).toBe('/cfg')
})

test('a main transcript with a subagent', async () => {
  const fake = fakeDisk()
  const { read } = fake
  fake.files.set(MAIN, mainFile())
  fake.files.set(META('a1'), '{"agentType":"Explore","description":"Find the hooks","toolUseId":"toolu_1"}')
  fake.files.set(SUB('a1'), assistant('s1', '2026-10-28T10:00:30.000Z', 'x'))
  const conversation = (await read(newReader(), 'c1'))!
  expect(conversation.id).toBe('c1')
  expect(conversation.project).toBe('/work/app')
  expect(conversation.title).toBe('Hello there')
  expect(conversation.startedAt).toBe(Date.parse('2026-10-28T09:59:00.000Z'))
  expect(conversation.subagents).toEqual([
    { agentId: 'a1', name: 'Find the hooks', parentAgentId: null, toolUseId: 'toolu_1' },
  ])
  expect(conversation.requests.length).toBe(3)
  expect(conversation.requests.filter((r) => r.agentId === 'a1').length).toBe(1)
  expect(conversation.requests.filter((r) => r.agentId === null).length).toBe(2)
})

test('the name falls back to the agent type', async () => {
  const fake = fakeDisk()
  const { read } = fake
  fake.files.set(MAIN, mainFile())
  fake.files.set(META('a1'), '{"agentType":"Explore","toolUseId":"toolu_1"}')
  fake.files.set(SUB('a1'), '')
  const conversation = (await read(newReader(), 'c1'))!
  expect(conversation.subagents[0]!.name).toBe('Explore')
})

test('a nested subagent points at the subagent that launched it', async () => {
  const fake = fakeDisk()
  const { read } = fake
  fake.files.set(MAIN, mainFile())
  fake.files.set(META('a1'), '{"agentType":"Explore","description":"First","toolUseId":"toolu_1"}')
  fake.files.set(SUB('a1'), assistant('s1', '2026-10-28T10:00:30.000Z', 'x', ['toolu_2']))
  fake.files.set(META('a2'), '{"agentType":"Explore","description":"Second","toolUseId":"toolu_2"}')
  fake.files.set(SUB('a2'), assistant('s2', '2026-10-28T10:00:40.000Z', 'y'))
  const conversation = (await read(newReader(), 'c1'))!
  const byId = Object.fromEntries(conversation.subagents.map((s) => [s.agentId, s]))
  expect(byId.a1!.parentAgentId).toBe(null)
  expect(byId.a2!.parentAgentId).toBe('a1')
})

test('a small read limit gives the same requests as an unlimited read', async () => {
  const fake = fakeDisk()
  const { read } = fake
  let text = prompt('Café 😀')
  for (let i = 0; i < 12; i++) text += assistant(String(i), `2026-10-28T10:${String(i).padStart(2, '0')}:00.000Z`, `é😀 ${'x'.repeat(10)}`)
  fake.files.set(MAIN, text)
  const whole = await read(newReader(), 'c1')
  fake.limit = 300
  fake.runs.length = 0
  const cut = await read(newReader(), 'c1')
  expect(fake.runs.filter((argv) => argv[0] === 'tail').length).toBeGreaterThan(5)
  expect(whole!.requests.length).toBe(12)
  expect(cut).toEqual(whole)
})

test('a call after an append adds only the new request', async () => {
  const fake = fakeDisk()
  const { read } = fake
  fake.files.set(MAIN, mainFile())
  const reader: Reader = newReader()
  expect((await read(reader, 'c1'))!.requests.length).toBe(2)
  expect((await read(reader, 'c1'))!.requests.length).toBe(2)
  fake.files.set(MAIN, mainFile() + assistant('3', '2026-10-28T10:02:00.000Z', 'é😀'))
  const conversation = (await read(reader, 'c1'))!
  expect(conversation.requests.map((r) => r.messageId)).toEqual(['msg_1', 'msg_2', 'msg_3'])
})

test('a half-written last line is read once it is complete', async () => {
  const fake = fakeDisk()
  const { read } = fake
  const last = assistant('3', '2026-10-28T10:02:00.000Z', 'c')
  fake.files.set(MAIN, mainFile() + last.slice(0, 40))
  const reader: Reader = newReader()
  expect((await read(reader, 'c1'))!.requests.length).toBe(2)
  fake.files.set(MAIN, mainFile() + last)
  expect((await read(reader, 'c1'))!.requests.length).toBe(3)
})

test('a different conversation id reads the other file only', async () => {
  const fake = fakeDisk()
  const { read } = fake
  fake.files.set(MAIN, mainFile())
  fake.files.set(`${DIR}/c2.jsonl`, assistant('9', '2026-10-28T11:00:00.000Z', 'z'))
  const reader: Reader = newReader()
  expect((await read(reader, 'c1'))!.requests.length).toBe(2)
  const other = (await read(reader, 'c2'))!
  expect(other.id).toBe('c2')
  expect(other.requests.map((r) => r.messageId)).toEqual(['msg_9'])
})

test('no transcript file yet gives null, and the file is found later', async () => {
  const fake = fakeDisk()
  const { read } = fake
  const reader: Reader = newReader()
  expect(await read(reader, 'c1')).toBe(null)
  fake.files.set(MAIN, mainFile())
  expect((await read(reader, 'c1'))!.requests.length).toBe(2)
})

test('a transcript with no cwd uses the working directory of the engine', async () => {
  const fake = fakeDisk()
  const { read } = fake
  fake.files.set(MAIN, JSON.stringify({ type: 'ai-title', aiTitle: 'T' }) + '\n')
  const conversation = (await read(newReader(), 'c1'))!
  expect(conversation.project).toBe('/fallback')
  expect(conversation.title).toBe('T')
  expect(conversation.startedAt).toBe(0)
})

test('an unreadable subagent file is skipped, the main transcript still reads', async () => {
  const fake = fakeDisk()
  const { read } = fake
  fake.files.set(MAIN, mainFile())
  fake.files.set(META('a1'), '{"agentType":"Explore","toolUseId":"toolu_1"}')
  const conversation = (await read(newReader(), 'c1'))!
  expect(conversation.requests.length).toBe(2)
  expect(conversation.subagents.length).toBe(1)
})

test('a failing read of the main transcript gives null', async () => {
  const fake = fakeDisk()
  const { read } = fake
  fake.files.set(MAIN, mainFile())
  const reader: Reader = newReader()
  await read(reader, 'c1')
  fake.files.delete(MAIN)
  expect(await read(reader, 'c1')).toBe(null)
})

test('a complete line longer than the read limit is skipped', async () => {
  const fake = fakeDisk()
  const { read } = fake
  const big = prompt('x'.repeat(1000))
  fake.files.set(MAIN, assistant('1', '2026-10-28T10:00:00.000Z', 'a') + big + assistant('2', '2026-10-28T10:01:00.000Z', 'b'))
  fake.limit = 300
  const conversation = (await read(newReader(), 'c1'))!
  expect(conversation.requests.map((r) => r.messageId)).toEqual(['msg_1', 'msg_2'])
})

test('an oversized last line without its newline is kept until it is complete', async () => {
  const fake = fakeDisk()
  const { read } = fake
  const big = prompt('é'.repeat(1000))
  fake.files.set(MAIN, assistant('1', '2026-10-28T10:00:00.000Z', 'a') + big.slice(0, -1))
  fake.limit = 300
  const reader: Reader = newReader()
  expect((await read(reader, 'c1'))!.requests.map((r) => r.messageId)).toEqual(['msg_1'])
  expect((await read(reader, 'c1'))!.requests.map((r) => r.messageId)).toEqual(['msg_1'])
  fake.files.set(MAIN, assistant('1', '2026-10-28T10:00:00.000Z', 'a') + big + assistant('2', '2026-10-28T10:01:00.000Z', 'b'))
  expect((await read(reader, 'c1'))!.requests.map((r) => r.messageId)).toEqual(['msg_1', 'msg_2'])
})
