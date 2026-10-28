import { expect, test } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'

import { exec, loadWindows, openDb, query } from './db'

type Call = { argv: string[]; stdin: string }

// An in-memory `$`: every process.run call is recorded and answered by `reply`.
function fake(reply: (call: Call) => { exitCode: number; stdout: string; stderr?: string } | Error) {
  const calls: Call[] = []
  const $ = {
    env: { get: async (name: string) => (name === 'HOME' ? '/home/u' : undefined) },
    process: {
      run: async (argv: readonly string[], options?: { stdin?: string }) => {
        const call = { argv: [...argv], stdin: options?.stdin ?? '' }
        calls.push(call)
        const r = reply(call)
        if (r instanceof Error) throw r
        return { stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...r }
      },
    },
  } as unknown as EngineInterface
  return { $, calls }
}

const db = { path: '/home/u/.claude/conversation-usage.db' }

test('openDb reports a missing sqlite3', async () => {
  const { $ } = fake(() => new Error('spawn sqlite3 ENOENT'))
  expect(await openDb($)).toEqual({ error: 'Usage history needs sqlite3 on the PATH' })
})

test('openDb creates the schema in the config directory', async () => {
  const { $, calls } = fake(() => ({ exitCode: 0, stdout: '' }))
  const opened = await openDb($)
  expect(opened).toEqual(db)
  expect(calls[0]!.argv).toEqual(['sqlite3', '-json', db.path])
  expect(calls[0]!.stdin).toContain('CREATE TABLE IF NOT EXISTS requests')
})

test('query maps empty output to no rows', async () => {
  const { $ } = fake(() => ({ exitCode: 0, stdout: '' }))
  expect(await query($, db, 'SELECT 1', (row) => row)).toEqual([])
})

test('query maps each row', async () => {
  const { $ } = fake(() => ({ exitCode: 0, stdout: '[{"a":1},{"a":2}]\n' }))
  expect(await query($, db, 'SELECT a', (row) => Number(row.a))).toEqual([1, 2])
})

test('the stdin starts with the busy timeout', async () => {
  const { $, calls } = fake(() => ({ exitCode: 0, stdout: '' }))
  await exec($, db, 'SELECT 1;')
  expect(calls[0]!.stdin.startsWith('.timeout 5000\n')).toBe(true)
  expect(calls[0]!.stdin).toContain('\n.bail on\n')
  expect(calls[0]!.stdin.endsWith('SELECT 1;')).toBe(true)
})

test('a non-zero exit throws with stderr', async () => {
  const { $ } = fake(() => ({ exitCode: 1, stdout: '', stderr: 'database is locked' }))
  await expect(exec($, db, 'SELECT 1;')).rejects.toThrow('database is locked')
})

test('loadWindows maps the rows', async () => {
  const { $ } = fake(() => ({
    exitCode: 0,
    stdout: '[{"kind":"five_hour","start":10,"end":20,"percent_used":42.5}]',
  }))
  expect(await loadWindows($, db)).toEqual([{ kind: 'five_hour', start: 10, end: 20, percentUsed: 42.5 }])
})

test('openDb reports the message of a failing sqlite3', async () => {
  const { $ } = fake(() => ({ exitCode: 1, stdout: '', stderr: 'file is not a database' }))
  expect(await openDb($)).toEqual({ error: 'file is not a database' })
})

test('a truncated stdout throws a clear one-line error', async () => {
  const { $ } = fake(() => ({ exitCode: 0, stdout: '[{"a":', isStdoutTruncated: true }))
  await expect(query($, db, 'SELECT a', (row) => row)).rejects.toThrow('Usage history result is too large')
})

test('openDb reports a timeout or bad output under its own message, not as a missing sqlite3', async () => {
  const { $ } = fake(() => new Error('timed out after 20000ms'))
  expect(await openDb($)).toEqual({ error: 'timed out after 20000ms' })
})

test('openDb reports a rejected spawn as a missing sqlite3', async () => {
  const { $ } = fake(() => Object.assign(new Error('spawn sqlite3 ENOENT'), { code: 'ENOENT' }))
  expect(await openDb($)).toEqual({ error: 'Usage history needs sqlite3 on the PATH' })
})
