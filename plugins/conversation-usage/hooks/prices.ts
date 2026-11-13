import type { Costs, PriceBook, PriceRow, Rates, Request, Tokens } from '../types'

// The official pricing page, as Markdown.
export const PRICING_URL = 'https://platform.claude.com/docs/en/about-claude/pricing.md'

// When the built-in prices were read from the pricing page.
export const BUILT_IN_CHECKED_AT = new Date(2026, 10, 11).getTime()

const rates = (
  input: number,
  cacheWrite5m: number,
  cacheWrite1h: number,
  cacheRead: number,
  output: number,
): Rates => ({ input, cacheWrite5m, cacheWrite1h, cacheRead, output })

const row = (model: string, r: Rates, extra: Partial<PriceRow> = {}): PriceRow => ({
  since: 0,
  model,
  rates: r,
  fastFactor: null,
  longAbove: null,
  longRates: null,
  ...extra,
})

// USD per million tokens, in the order of the pricing page. `since` 0: in effect for every request
// older than the first downloaded list, and for every model no downloaded list names.
export const BUILT_IN: PriceRow[] = [
  row('claude-fable-5-2', rates(8, 10, 16, 0.2, 40), { fastFactor: 2 }),
  row('claude-mythos-5-2', rates(8, 10, 16, 0.2, 40), { fastFactor: 2 }),
  row('claude-fable-5-1', rates(10, 12.5, 20, 0.25, 50)),
  row('claude-mythos-5-1', rates(10, 12.5, 20, 0.25, 50)),
  row('claude-fable-5', rates(10, 12.5, 20, 1, 50)),
  row('claude-mythos-5', rates(10, 12.5, 20, 1, 50)),
  row('claude-opus-5-5', rates(4, 5, 8, 0.2, 20), { fastFactor: 2 }),
  row('claude-opus-5', rates(5, 6.25, 10, 0.5, 25), { fastFactor: 2 }),
  row('claude-opus-4-8', rates(5, 6.25, 10, 0.5, 25), { fastFactor: 2 }),
  row('claude-opus-4-7', rates(5, 6.25, 10, 0.5, 25)),
  row('claude-opus-4-6', rates(5, 6.25, 10, 0.5, 25)),
  row('claude-opus-4-5', rates(5, 6.25, 10, 0.5, 25)),
  row('claude-opus-4-1', rates(15, 18.75, 30, 1.5, 75)),
  row('claude-opus-4', rates(15, 18.75, 30, 1.5, 75)),
  row('claude-sonnet-5-5', rates(2, 2.5, 4, 0.1, 10)),
  row('claude-sonnet-5', rates(2, 2.5, 4, 0.2, 10)),
  row('claude-sonnet-4-6', rates(3, 3.75, 6, 0.3, 15)),
  row('claude-sonnet-4-5', rates(3, 3.75, 6, 0.3, 15)),
  row('claude-sonnet-4', rates(3, 3.75, 6, 0.3, 15)),
  row('claude-haiku-5-5', rates(0.1, 0.125, 0.2, 0.01, 0.5), {
    longAbove: 100_000,
    longRates: rates(0.5, 0.625, 1, 0.05, 2.5),
  }),
  row('claude-haiku-4-5', rates(1, 1.25, 2, 0.1, 5)),
]

export const BUILT_IN_BOOK: PriceBook = {
  rows: BUILT_IN,
  source: 'built-in',
  checkedAt: BUILT_IN_CHECKED_AT,
  since: 0,
  error: null,
}

// The price key of a model id: the id without a trailing `[...]` tag (`[1m]`) and without a trailing
// date (`-20261001` or `@20261001`). A model prices only under its exact key, so a new model or a new
// version of one has no price until a price list names it.
export const priceKey = (model: string): string => model.replace(/\[[^\]]*\]$/, '').replace(/[-@]\d{8}$/, '')

// The row in effect for `model` at `at`: the newest row whose `since` is at or before `at`, else the
// oldest row of that model. Null when no row names the model.
export function rowFor(rows: PriceRow[], model: string, at: number): PriceRow | null {
  const key = priceKey(model)
  let before: PriceRow | null = null
  let after: PriceRow | null = null
  for (const r of rows) {
    if (r.model !== key) continue
    if (r.since <= at) {
      if (before === null || r.since > before.since) before = r
    } else if (after === null || r.since < after.since) after = r
  }
  return before ?? after
}

// The prices in use. register.tsx replaces them with the book stored in the database.
let book: PriceBook = BUILT_IN_BOOK
export const usePriceBook = (next: PriceBook): void => {
  book = next
}

export const ZERO_TOKENS: Tokens = { input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 }

export const addTokens = (a: Tokens, b: Tokens): Tokens => ({
  input: a.input + b.input,
  cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
  cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
  cacheRead: a.cacheRead + b.cacheRead,
  output: a.output + b.output,
})

export const totalTokens = (t: Tokens): number => t.input + t.cacheWrite5m + t.cacheWrite1h + t.cacheRead + t.output

// Every input token of a request, cache reads and writes included: what a long-context threshold counts.
export const promptTokens = (t: Tokens): number => t.input + t.cacheWrite5m + t.cacheWrite1h + t.cacheRead

export const addCosts = (a: Costs | null, b: Costs | null): Costs | null => {
  if (!a) return b
  if (!b) return a
  return {
    input: a.input + b.input,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    cacheRead: a.cacheRead + b.cacheRead,
    output: a.output + b.output,
    total: a.total + b.total,
  }
}

// The cost of one request at the prices in effect when it ran; null when no price list names its model.
// The same rule as `repriceRequests` in sql.ts, which prices the stored requests.
export function costOf(
  r: Pick<Request, 'model' | 'tokens' | 'isFast' | 'at'>,
  rows: PriceRow[] = book.rows,
): Costs | null {
  const price = rowFor(rows, r.model, r.at)
  if (price === null) return null
  const t = r.tokens
  const isLong = price.longAbove !== null && price.longRates !== null && promptTokens(t) > price.longAbove
  const p = isLong && price.longRates !== null ? price.longRates : price.rates
  const factor = r.isFast && price.fastFactor !== null ? price.fastFactor : 1
  const per = (rate: number) => (rate * factor) / 1e6
  const input = t.input * per(p.input)
  const cacheWrite = t.cacheWrite5m * per(p.cacheWrite5m) + t.cacheWrite1h * per(p.cacheWrite1h)
  const cacheRead = t.cacheRead * per(p.cacheRead)
  const output = t.output * per(p.output)
  return { input, cacheWrite, cacheRead, output, total: input + cacheWrite + cacheRead + output }
}

// Whether two price lists hold the same models at the same prices, whatever their `since` and order.
export function samePrices(a: PriceRow[], b: PriceRow[]): boolean {
  const canonical = (rows: PriceRow[]) =>
    JSON.stringify([...rows].map(r => ({ ...r, since: 0 })).sort((x, y) => x.model.localeCompare(y.model)))
  return canonical(a) === canonical(b)
}
