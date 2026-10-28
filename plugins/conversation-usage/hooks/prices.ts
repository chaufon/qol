import type { Costs, Request, Tokens } from '../types'

type Price = { input: number; cacheRead: number; output: number }

// USD per million tokens. A cache write costs input x CACHE_WRITE_5M or x CACHE_WRITE_1H.
export const PRICES: Record<string, Price> = {
  'claude-fable-5-1': { input: 10, cacheRead: 0.25, output: 50 },
  'claude-mythos-5-1': { input: 10, cacheRead: 0.25, output: 50 },
  'claude-fable-5': { input: 10, cacheRead: 1, output: 50 },
  'claude-mythos-5': { input: 10, cacheRead: 1, output: 50 },
  'claude-opus-5-5': { input: 4, cacheRead: 0.2, output: 20 },
  'claude-opus-5': { input: 5, cacheRead: 0.5, output: 25 },
  'claude-opus-4-8': { input: 5, cacheRead: 0.5, output: 25 },
  'claude-opus-4-7': { input: 5, cacheRead: 0.5, output: 25 },
  'claude-opus-4-6': { input: 5, cacheRead: 0.5, output: 25 },
  'claude-sonnet-5-5': { input: 2, cacheRead: 0.2, output: 10 },
  'claude-sonnet-5': { input: 2, cacheRead: 0.2, output: 10 },
  'claude-sonnet-4-6': { input: 3, cacheRead: 0.3, output: 15 },
  'claude-haiku-5-5': { input: 0.1, cacheRead: 0.01, output: 0.5 },
  'claude-haiku-4-5': { input: 1, cacheRead: 0.1, output: 5 },
}

export const CACHE_WRITE_5M = 1.25
export const CACHE_WRITE_1H = 2
export const FAST_MODELS = ['claude-opus-5-5', 'claude-opus-5']
export const LONG_CONTEXT_MODEL = 'claude-haiku-5-5'
export const LONG_CONTEXT_TOKENS = 100_000
export const LONG_CONTEXT_FACTOR = 5
export const FAST_FACTOR = 2

export const ZERO_TOKENS: Tokens = { input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 }

export const addTokens = (a: Tokens, b: Tokens): Tokens => ({
  input: a.input + b.input,
  cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
  cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
  cacheRead: a.cacheRead + b.cacheRead,
  output: a.output + b.output,
})

export const totalTokens = (t: Tokens): number => t.input + t.cacheWrite5m + t.cacheWrite1h + t.cacheRead + t.output

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

// The table key the model id starts with, longest first; null when none matches.
const keyOf = (model: string): string | null => {
  let best: string | null = null
  for (const key of Object.keys(PRICES)) {
    if (model.startsWith(key) && (best === null || key.length > best.length)) best = key
  }
  return best
}

export const costOf = (r: Pick<Request, 'model' | 'tokens' | 'isFast'>): Costs | null => {
  const key = keyOf(r.model)
  if (key === null) return null
  const price = PRICES[key]!
  const t = r.tokens
  let factor = 1
  if (key === LONG_CONTEXT_MODEL && t.input + t.cacheWrite5m + t.cacheWrite1h + t.cacheRead > LONG_CONTEXT_TOKENS) {
    factor *= LONG_CONTEXT_FACTOR
  }
  if (r.isFast && FAST_MODELS.includes(key)) factor *= FAST_FACTOR
  const perToken = (rate: number) => (rate * factor) / 1e6
  const input = t.input * perToken(price.input)
  const cacheWrite = t.cacheWrite5m * perToken(price.input * CACHE_WRITE_5M) + t.cacheWrite1h * perToken(price.input * CACHE_WRITE_1H)
  const cacheRead = t.cacheRead * perToken(price.cacheRead)
  const output = t.output * perToken(price.output)
  return { input, cacheWrite, cacheRead, output, total: input + cacheWrite + cacheRead + output }
}
