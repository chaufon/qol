// Finds the file references in a reply's markdown and turns each one that names an existing file into a `file:` link.
// A reference is a path, then an optional line: `src/app.ts`, `src/app.ts:42`, `src/app.ts:42:7`, `src/app.ts:42-58`
// or `src/app.ts#L42`. In plain text the path needs an extension; inside a code span any path counts. A path may start
// with a Windows drive (`C:\proj\app.ts`), and `\` separates its parts as `/` does.

export type Reference = { path: string; line: number | null }

// The most lines the pane draws above the referenced line, and the most characters it draws in all.
const LINES_ABOVE = 300
const MAX_CHARS = 90_000

const PATH = String.raw`(?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|[\\/])?(?:[\w.@+-]+[\\/])*`
const LINE = String.raw`(?::(\d+)(?:[-:]\d+)?|#L(\d+)(?:-L?\d+)?)?`

// Code fences, markdown links and URLs: text no reference is looked for in.
const PROTECTED = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|!?\[[^\]\n]*\]\([^)\n]*\)|<https?:[^>\s]+>|https?:\/\/\S+/g
const CODE_SPAN = /`([^`\n]+)`/g
const PLAIN = new RegExp(String.raw`(?<![\w/\\.~@+-])(${PATH}[\w@+-][\w.@+-]*\.[A-Za-z0-9]+)${LINE}(?![\w/\\])`, 'g')
const SPAN = new RegExp(String.raw`^(${PATH}[\w.@+-]+)${LINE}$`)

// The path is group 1; the line is group 2 after a colon, group 3 after `#L`.
function toReference(match: RegExpExecArray): Reference {
  const line = match[2] ?? match[3]
  return { path: match[1] ?? '', line: line === undefined ? null : Number(line) }
}

// Calls `visit` on each code span and plain-text piece outside the protected regions, and joins what it returns.
function mapPieces(text: string, visit: (piece: string, isSpan: boolean) => string): string {
  const plain = (part: string) => {
    let out = ''
    let last = 0
    for (const span of part.matchAll(CODE_SPAN)) {
      out += visit(part.slice(last, span.index), false) + visit(span[0], true)
      last = span.index + span[0].length
    }
    return out + visit(part.slice(last), false)
  }
  let out = ''
  let last = 0
  for (const region of text.matchAll(PROTECTED)) {
    out += plain(text.slice(last, region.index)) + region[0]
    last = region.index + region[0].length
  }
  return out + plain(text.slice(last))
}

// Every reference written in `text`, in order, repeats included.
export function references(text: string): Reference[] {
  const found: Reference[] = []
  mapPieces(text, (piece, isSpan) => {
    if (isSpan) {
      const match = SPAN.exec(piece.slice(1, -1))
      if (match) found.push(toReference(match))
    } else {
      for (const match of piece.matchAll(PLAIN)) found.push(toReference(match))
    }
    return piece
  })
  return found
}

// `path` is absolute with `/` separators: `/repo/app.ts`, or `C:/repo/app.ts` on Windows.
export function toHref(path: string, line: number | null): string {
  return `file://${path.startsWith('/') ? '' : '/'}${encodeURI(path).replace(/#/g, '%23').replace(/\?/g, '%3F')}${line === null ? '' : `#L${line}`}`
}

export function fromHref(href: string): Reference | null {
  if (!href.startsWith('file://')) return null
  const url = new URL(href)
  const line = /^#L(\d+)$/.exec(url.hash)
  return { path: decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:\/)/, '$1'), line: line ? Number(line[1]) : null }
}

// Rewrites each reference whose path `resolve` maps to an absolute path as a link, and returns the links' targets.
export function linkify(text: string, resolve: (path: string) => string | undefined): { text: string; hrefs: string[] } {
  const hrefs = new Set<string>()
  const link = (label: string, { path, line }: Reference) => {
    const absolute = resolve(path)
    if (absolute === undefined) return label
    const href = toHref(absolute, line)
    hrefs.add(href)
    return `[${label}](${href})`
  }
  const out = mapPieces(text, (piece, isSpan) => {
    if (isSpan) {
      const match = SPAN.exec(piece.slice(1, -1))
      return match ? link(piece, toReference(match)) : piece
    }
    let out = ''
    let last = 0
    for (const match of piece.matchAll(PLAIN)) {
      out += piece.slice(last, match.index) + link(match[0], toReference(match))
      last = match.index + match[0].length
    }
    return out + piece.slice(last)
  })
  return { text: out, hrefs: [...hrefs] }
}

// The lines the pane draws: up to LINES_ABOVE above the referenced line, then as many after it as MAX_CHARS allows.
export function lineWindow(lines: string[], line: number | null): { first: number; last: number } {
  const target = line === null ? 1 : Math.min(Math.max(line, 1), lines.length)
  const first = Math.max(1, target - LINES_ABOVE)
  let chars = 0
  let last = first - 1
  while (last < lines.length && (last < target || chars + (lines[last]?.length ?? 0) + 1 <= MAX_CHARS)) {
    chars += (lines[last]?.length ?? 0) + 1
    last++
  }
  return { first, last }
}
