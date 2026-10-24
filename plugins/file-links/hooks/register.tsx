import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ShownFile } from '../types'
import { fromHref, linkify, lineWindow, references } from './links'

const PANE = 'file-links'
const MAX_PRESSABLE = 256
// The tiers of the mods a person or an administrator installs, as against Claude Code's own built-ins and engine.
const INSTALLED_TIERS: readonly string[] = ['prepend', 'user', 'append']

const shown = atom({ plugin: 'file-links', key: 'shown' } as const, null as ShownFile | null)
const indexVersion = atom({ plugin: 'file-links', key: 'indexVersion' } as const, 0)

// The project's files by path relative to the working directory, and by file name, from `git ls-files`.
type FileIndex = { cwd: string; files: Set<string>; byName: Map<string, string[]> }

let index: FileIndex | undefined
// What each written path resolved to (an absolute path, or null for no file), kept until the index is rebuilt.
let resolved = new Map<string, string | null>()

// Paths are kept with `/` separators, a Windows path too (`C:/proj/app.ts`): Windows takes either separator.
function slashes(path: string): string {
  return path.replace(/\\/g, '/')
}

function isAbsolute(path: string): boolean {
  return /^(?:\/|[A-Za-z]:\/)/.test(path)
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function join(cwd: string, path: string): string {
  return `${cwd.replace(/\/$/, '')}/${path}`
}

export function sameFiles(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const file of a) if (!b.has(file)) return false
  return true
}

async function buildIndex($: EngineInterface) {
  const cwd = slashes(await $.session.cwd())
  const files = new Set<string>()
  const byName = new Map<string, string[]>()
  try {
    const ran = await $.process.run(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
                                    { cwd, timeoutMs: 10_000 })
    if (ran.exitCode === 0) {
      for (const file of ran.stdout.split('\0')) {
        if (!file) continue
        files.add(file)
        const name = baseName(file)
        byName.set(name, [...(byName.get(name) ?? []), file])
      }
    }
  } catch {
    // No git on this machine: references resolve by stat alone.
  }
  // With the same file list, replies already drawn keep their links: only the paths that named no file are looked up
  // again, by the next reply that writes them.
  if (index !== undefined && index.cwd === cwd && sameFiles(index.files, files)) {
    for (const [path, found] of resolved) if (found === null) resolved.delete(path)
    return
  }
  index = { cwd, files, byName }
  resolved = new Map()
  await update($, indexVersion, n => n + 1)
}

async function isFile($: EngineInterface, path: string): Promise<string | null> {
  const stat = await $.fs.stat(path, { resolve: true }).catch(() => undefined)
  return stat?.kind === 'file' ? slashes(stat.realPath ?? path) : null
}

// The absolute path of the file a reply's path names, or null. A path the index holds wins; then a project file whose
// path ends with it, when exactly one does; then the file the path names on disk.
async function resolvePath($: EngineInterface, written: string): Promise<string | null> {
  const known = resolved.get(written)
  if (known !== undefined) return known
  const { cwd, files, byName }: FileIndex =
    index ?? { cwd: slashes(await $.session.cwd()), files: new Set(), byName: new Map() }
  let path = slashes(written).replace(/^\.\//, '')
  let found: string | null = null
  if (path.startsWith('~/')) {
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
    path = home === undefined ? path : join(slashes(home), path.slice(2))
  }
  if (isAbsolute(path)) {
    found = await isFile($, path)
  } else if (files.has(path)) {
    found = join(cwd, path)
  } else {
    const matches = (byName.get(baseName(path)) ?? []).filter(file => file === path || file.endsWith(`/${path}`))
    found = matches[0] !== undefined && matches.length === 1 ? join(cwd, matches[0]) : await isFile($, join(cwd, path))
  }
  resolved.set(written, found)
  return found
}

// The mods already named in a toast this session for drawing a reply themselves.
const reported = new Set<string>()

function reportDrawnBy($: EngineInterface, plugin: string) {
  if (reported.has(plugin)) return
  reported.add(plugin)
  $.ui.toast(`file-links: ${plugin} draws Claude's replies itself, so file references in them are not links`,
             { timeoutMs: 10_000 })
}

function labelOf(cwd: string, path: string): string {
  const root = `${cwd.replace(/\/$/, '')}/`
  return path.startsWith(root) ? path.slice(root.length) : path
}

// Scrolls the pane to the referenced line once the tree that draws it is up.
async function scrollToLine($: EngineInterface, file: ShownFile) {
  const to = file.line === null ? 'start' : { key: `line-${file.opened}` }
  for (let tries = 0; tries < 40; tries++) {
    const moved = await $.ui.scroll({ in: PANE, to, block: 'center' })
    if (!moved.deny) return
    await $.clock.sleep(50)
  }
}

async function openFile($: EngineInterface, href: string) {
  const reference = fromHref(href)
  if (!reference) return
  const cwd = slashes(await $.session.cwd())
  const file: ShownFile = { ...reference, label: labelOf(cwd, reference.path), opened: Date.now() }
  await update($, shown, () => file)
  await $.ui.open({ id: PANE, title: baseName(file.path), closeOnEscape: true })
  await scrollToLine($, file)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await buildIndex($)
    return result
  })

  // Files written during a turn show up in the next index.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await buildIndex($)
    return result
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await update($, shown, () => null)
    return next(e)
  })

  // Only the fullscreen terminal reports a click on a link, so other surfaces draw the reply as written.
  // The reply is linked as Claude Code draws it, after every mod beneath has rewritten it (grammar-tracker hides its
  // check there), so the links are added last wherever this mod sits in the chain. An installed mod beneath that draws
  // the reply itself keeps its drawing, and a toast names it once per session.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.viewport?.isFullscreen !== true) return next(e)
    const drawn = await next(e)
    const bottom = next.trace.at(-1)
    if (bottom === undefined || INSTALLED_TIERS.includes(bottom.tier)) {
      reportDrawnBy($, bottom?.plugin ?? 'another mod')
      return drawn
    }
    const reply = bottom.received.props.text
    await read($, indexVersion)
    const written = [...new Set(references(reply).map(reference => reference.path))]
    const paths = new Map<string, string>()
    for (const path of written) {
      const found = await resolvePath($, path)
      if (found !== null) paths.set(path, found)
    }
    if (paths.size === 0) return drawn
    const { text, hrefs } = linkify(reply, path => paths.get(path))
    const { Markdown } = $.ui.resolve(e)
    return (
      <Markdown
        key={`reply-${e.requestId}`}
        text={text}
        pressableLinks={hrefs.slice(0, MAX_PRESSABLE)}
        onLinkPress={link => openFile($, link.href)}
      />
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Code, Text } = $.ui.resolve(e)
    const file = await read($, shown)
    if (file === null) return <Text dimColor>Click a file reference in a reply to show the file here.</Text>
    let source: string
    try {
      source = await $.fs.read(file.path)
    } catch (error) {
      return <Text color="error">{`${file.label}: ${String(error)}`}</Text>
    }
    if (source.includes('\0')) return <Text dimColor>{`${file.label}: binary file, not shown`}</Text>
    const lines = source.split(/\r?\n/)
    const { first, last } = lineWindow(lines, file.line)
    const target = file.line === null ? null : Math.min(Math.max(file.line, 1), lines.length)
    const header = target === null ? file.label : `${file.label}:${target}`
    const code = (from: number, to: number) =>
      from > to ? null : <Code source={lines.slice(from - 1, to).join('\n')} path={file.path} startLine={from} />
    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        <Text bold>{header}</Text>
        <Text dimColor>{`${lines.length} lines${last < lines.length || first > 1 ? `, showing ${first}-${last}` : ''}`}</Text>
        {target === null ? (
          code(first, last)
        ) : (
          <Box flexDirection="column">
            {code(first, target - 1)}
            <Box key={`line-${file.opened}`} backgroundColor="subtle">
              {code(target, target)}
            </Box>
            {code(target + 1, last)}
          </Box>
        )}
      </Box>
    )
  })
}
