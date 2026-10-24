import { expect, test } from 'claude-code/testing'

import { fromHref, lineWindow, linkify, references, toHref } from './links'

const FILES: Record<string, string> = {
  'src/app.ts': '/repo/src/app.ts',
  'app.ts': '/repo/src/app.ts',
  'Makefile': '/repo/Makefile',
  'hooks/register.tsx': '/repo/hooks/register.tsx',
}
const resolve = (path: string) => FILES[path]

test('finds references in plain text and code spans, with their lines', () => {
  expect(references('See src/app.ts:42, `hooks/register.tsx:7:3` and app.ts#L9. Run `Makefile`.')).toEqual([
    { path: 'src/app.ts', line: 42 },
    { path: 'hooks/register.tsx', line: 7 },
    { path: 'app.ts', line: 9 },
    { path: 'Makefile', line: null },
  ])
})

test('a range keeps its first line', () => {
  expect(references('lines src/app.ts:42-58')).toEqual([{ path: 'src/app.ts', line: 42 }])
})

test('leaves fences, links, URLs and version numbers alone', () => {
  const text = '```\nsrc/app.ts:1\n```\n[src/app.ts](https://x.io/src/app.ts) https://x.io/app.ts Python 3.14'
  expect(references(text).filter(r => r.path in FILES)).toEqual([])
})

test('a sentence-ending period is not part of the path', () => {
  expect(references('Edit src/app.ts.')).toEqual([{ path: 'src/app.ts', line: null }])
})

test('links only the paths that resolve', () => {
  const { text, hrefs } = linkify('Open `src/app.ts:42` or missing.ts:3, then app.ts.', resolve)
  expect(text).toBe('Open [`src/app.ts:42`](file:///repo/src/app.ts#L42) or missing.ts:3, then [app.ts](file:///repo/src/app.ts).')
  expect(hrefs).toEqual(['file:///repo/src/app.ts#L42', 'file:///repo/src/app.ts'])
})

test('a link target reads back as the path and line', () => {
  expect(fromHref(toHref('/a dir/x#1.ts', 12))).toEqual({ path: '/a dir/x#1.ts', line: 12 })
  expect(fromHref(toHref('/a/b.ts', null))).toEqual({ path: '/a/b.ts', line: null })
  expect(fromHref('https://x.io')).toBe(null)
})

test('finds Windows paths, with a drive or backslashes', () => {
  expect(references('See C:\\proj\\src\\app.ts:42, `src\\app.ts` and C:/proj/Makefile.mk.')).toEqual([
    { path: 'C:\\proj\\src\\app.ts', line: 42 },
    { path: 'src\\app.ts', line: null },
    { path: 'C:/proj/Makefile.mk', line: null },
  ])
})

test('a Windows link target reads back as the path and line', () => {
  expect(toHref('C:/a dir/b.ts', 3)).toBe('file:///C:/a%20dir/b.ts#L3')
  expect(fromHref(toHref('C:/a dir/b.ts', 3))).toEqual({ path: 'C:/a dir/b.ts', line: 3 })
})

test('the window keeps the referenced line and the lines around it', () => {
  const lines = Array.from({ length: 1000 }, (_, n) => `line ${n + 1}`)
  expect(lineWindow(lines, 500)).toEqual({ first: 200, last: 1000 })
  expect(lineWindow(lines, null)).toEqual({ first: 1, last: 1000 })
  expect(lineWindow(lines, 5000).first).toBe(700)
})
