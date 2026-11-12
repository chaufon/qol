import type { PriceRow, Rates } from '../types'

// Reads the price rows out of the Markdown of the official pricing page (PRICING_URL in prices.ts).
//
// The "Model pricing" section holds one table: a model name, then base input, 5-minute cache write,
// 1-hour cache write, cache hit and output, each as `$N / MTok`. A model priced by prompt length has
// two rows, "(for prompts up to N tokens)" and "(for prompts over N tokens)". The "Fast mode pricing"
// section holds a table of fast input and output prices; fast mode multiplies every rate of the model
// by fast input / base input. A name is "Claude <Family> <version>"; its model id is
// `claude-<family>-<version with - for .>`. Any other name is skipped.

// Fewer models than this means the page did not read as expected.
const MIN_MODELS = 5

const NAME = /^Claude ([A-Za-z]+) (\d+(?:\.\d+)?)$/
const LONG = /\(for prompts (up to|over) ([\d,]+) tokens\)/i

// The lines of the section under `heading` (any level), up to the next heading of the same or a higher level.
function section(lines: string[], heading: string): string[] {
  const start = lines.findIndex((l) => /^#+ /.test(l) && l.replace(/^#+ /, '').trim().toLowerCase() === heading.toLowerCase())
  if (start === -1) return []
  const level = lines[start]!.match(/^#+/)![0].length
  const out: string[] = []
  for (const line of lines.slice(start + 1)) {
    const m = line.match(/^(#+) /)
    if (m && m[1]!.length <= level) break
    out.push(line)
  }
  return out
}

// The body rows of the first table in `lines`, each as its trimmed cells; the header and the rule are left out.
function firstTable(lines: string[]): string[][] {
  const start = lines.findIndex((l) => l.trim().startsWith('|'))
  if (start === -1) return []
  const rows: string[][] = []
  for (const line of lines.slice(start)) {
    if (!line.trim().startsWith('|')) break
    rows.push(line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()))
  }
  return rows.slice(2)
}

// The model ids a name cell stands for, and the long-context marker it carries, if any.
function namesOf(cell: string): { ids: string[]; long: { isOver: boolean; above: number } | null } {
  const marker = LONG.exec(cell)
  const long = marker ? { isOver: marker[1]!.toLowerCase() === 'over', above: Number(marker[2]!.replaceAll(',', '')) } : null
  const ids: string[] = []
  for (const part of cell.split(' / ')) {
    const name = part.replace(/\(.*$/, '').replace(/\s+/g, ' ').trim()
    const m = NAME.exec(name)
    if (m) ids.push(`claude-${m[1]!.toLowerCase()}-${m[2]!.replace('.', '-')}`)
  }
  return { ids, long }
}

// The number of a `$N / MTok` cell; null when it holds none.
function dollars(cell: string): number | null {
  const m = /\$\s*([\d,]*\.?\d+)/.exec(cell.replace(/<[^>]*>/g, ''))
  return m ? Number(m[1]!.replaceAll(',', '')) : null
}

function ratesOf(cells: string[]): Rates | null {
  const values = cells.slice(1, 6).map(dollars)
  if (values.length < 5 || values.some((v) => v === null)) return null
  const [input, cacheWrite5m, cacheWrite1h, cacheRead, output] = values as number[]
  return { input: input!, cacheWrite5m: cacheWrite5m!, cacheWrite1h: cacheWrite1h!, cacheRead: cacheRead!, output: output! }
}

export function parsePricingPage(markdown: string, since: number): PriceRow[] | { error: string } {
  const lines = markdown.split('\n')
  const rows = new Map<string, PriceRow>()
  for (const cells of firstTable(section(lines, 'Model pricing'))) {
    const { ids, long } = namesOf(cells[0] ?? '')
    const r = ratesOf(cells)
    if (r === null) continue
    for (const model of ids) {
      const known = rows.get(model) ?? { since, model, rates: r, fastFactor: null, longAbove: null, longRates: null }
      if (long?.isOver) Object.assign(known, { longAbove: long.above, longRates: r })
      else known.rates = r
      rows.set(model, known)
    }
  }
  if (rows.size < MIN_MODELS) return { error: `The pricing page lists ${rows.size} models in a form this mod reads` }
  for (const cells of firstTable(section(lines, 'Fast mode pricing'))) {
    const fastInput = dollars(cells[1] ?? '')
    if (fastInput === null) continue
    for (const model of namesOf(cells[0] ?? '').ids) {
      const known = rows.get(model)
      if (known && known.rates.input > 0) known.fastFactor = fastInput / known.rates.input
    }
  }
  return [...rows.values()]
}
