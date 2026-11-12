import { expect, test } from 'claude-code/testing'

import type { PriceRow } from '../types'
import { addCosts, addTokens, BUILT_IN, costOf, priceKey, rowFor, samePrices, totalTokens, ZERO_TOKENS } from './prices'

const MILLION = 1_000_000
const close = (actual: number, expected: number) => {
  expect(Math.abs(actual - expected)).toBeLessThan(1e-9)
}
const tokens = (over: Partial<typeof ZERO_TOKENS> = {}) => ({ ...ZERO_TOKENS, ...over })
const ask = (model: string, over: Partial<typeof ZERO_TOKENS>, isFast = false, at = 0) =>
  costOf({ model, isFast, at, tokens: tokens(over) })

test('costOf prices every token kind of claude-opus-5-5', () => {
  const c = ask('claude-opus-5-5', {
    input: MILLION,
    cacheWrite5m: MILLION,
    cacheWrite1h: MILLION,
    cacheRead: MILLION,
    output: MILLION,
  })
  expect(c).not.toBeNull()
  close(c!.input, 4)
  close(c!.cacheWrite, 13)
  close(c!.cacheRead, 0.2)
  close(c!.output, 20)
  close(c!.total, 37.2)
})

test('a model id prices under its exact name, with or without a date or a [..] tag', () => {
  expect(priceKey('claude-opus-5-5')).toBe('claude-opus-5-5')
  expect(priceKey('claude-opus-5-5[1m]')).toBe('claude-opus-5-5')
  expect(priceKey('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5')
  expect(priceKey('claude-opus-4-5@20251101')).toBe('claude-opus-4-5')
  close(ask('claude-opus-5-5[1m]', { input: MILLION })!.input, 4)
  close(ask('claude-haiku-4-5-20251001', { input: MILLION })!.input, 1)
})

test('a newer version of a model has no price until a list names it', () => {
  expect(ask('claude-opus-5-6', { input: MILLION })).toBeNull()
  expect(ask('claude-opus-5-5-1', { input: MILLION })).toBeNull()
  expect(ask('claude-fable-5-3', { input: MILLION })).toBeNull()
})

test('claude-fable-5-2 has its own prices, not those of claude-fable-5', () => {
  close(ask('claude-fable-5-2', { input: MILLION })!.input, 8)
  close(ask('claude-fable-5-2', { cacheRead: MILLION })!.cacheRead, 0.2)
  close(ask('claude-fable-5', { cacheRead: MILLION })!.cacheRead, 1)
})

test('claude-sonnet-5-5 cache reads cost $0.10', () => {
  close(ask('claude-sonnet-5-5', { cacheRead: MILLION })!.cacheRead, 0.1)
})

test('claude-haiku-5-5 takes its long-context prices above 100k prompt tokens, cache included', () => {
  close(ask('claude-haiku-5-5', { input: 150_000 })!.input, (150_000 / 1e6) * 0.5)
  close(ask('claude-haiku-5-5', { input: 100_000 })!.input, (100_000 / 1e6) * 0.1)
  const cached = ask('claude-haiku-5-5', { input: 1_000, cacheRead: 200_000, output: MILLION })!
  close(cached.cacheRead, (200_000 / 1e6) * 0.05)
  close(cached.output, 2.5)
})

test('fast mode multiplies the rates of the models that have it', () => {
  close(ask('claude-opus-5-5', { output: MILLION }, true)!.output, 40)
  close(ask('claude-opus-5', { output: MILLION }, true)!.output, 50)
  close(ask('claude-fable-5-2', { output: MILLION }, true)!.output, 80)
  close(ask('claude-sonnet-5', { output: MILLION }, true)!.output, 10)
})

test('an unknown or synthetic model has no cost', () => {
  expect(ask('<synthetic>', { input: 5 })).toBeNull()
  expect(ask('gpt-x', { input: 5 })).toBeNull()
})

const opus = (since: number, input: number): PriceRow => ({
  since,
  model: 'claude-opus-5-5',
  rates: { input, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 },
  fastFactor: null,
  longAbove: null,
  longRates: null,
})

test('a request takes the newest list in effect when it ran, else the oldest list', () => {
  const rows = [opus(1000, 4), opus(5000, 3)]
  expect(rowFor(rows, 'claude-opus-5-5', 500)!.rates.input).toBe(4)
  expect(rowFor(rows, 'claude-opus-5-5', 1000)!.rates.input).toBe(4)
  expect(rowFor(rows, 'claude-opus-5-5', 4999)!.rates.input).toBe(4)
  expect(rowFor(rows, 'claude-opus-5-5', 5000)!.rates.input).toBe(3)
  close(
    costOf({ model: 'claude-opus-5-5', isFast: false, at: 9000, tokens: tokens({ input: MILLION }) }, rows)!.input,
    3,
  )
  expect(rowFor(rows, 'claude-opus-5', 9000)).toBeNull()
})

test('samePrices ignores since and order', () => {
  expect(samePrices([opus(1, 4), BUILT_IN[0]!], [{ ...BUILT_IN[0]!, since: 7 }, opus(9, 4)])).toBe(true)
  expect(samePrices([opus(1, 4)], [opus(1, 3)])).toBe(false)
  expect(samePrices([opus(1, 4)], [opus(1, 4), BUILT_IN[0]!])).toBe(false)
})

test('addCosts treats null as nothing', () => {
  const c = { input: 1, cacheWrite: 2, cacheRead: 3, output: 4, total: 10 }
  expect(addCosts(null, c)).toEqual(c)
  expect(addCosts(c, null)).toEqual(c)
  expect(addCosts(null, null)).toBeNull()
  expect(addCosts(c, c)).toEqual({ input: 2, cacheWrite: 4, cacheRead: 6, output: 8, total: 20 })
})

test('addTokens and totalTokens sum every kind', () => {
  const a = { input: 1, cacheWrite5m: 2, cacheWrite1h: 3, cacheRead: 4, output: 5 }
  expect(addTokens(a, a)).toEqual({ input: 2, cacheWrite5m: 4, cacheWrite1h: 6, cacheRead: 8, output: 10 })
  expect(totalTokens(a)).toBe(15)
  expect(totalTokens(ZERO_TOKENS)).toBe(0)
})
