import { expect, test } from 'claude-code/testing'

import { addCosts, addTokens, costOf, totalTokens, ZERO_TOKENS } from './prices'

const MILLION = 1_000_000
const close = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(1e-9)
const tokens = (over: Partial<typeof ZERO_TOKENS> = {}) => ({ ...ZERO_TOKENS, ...over })

test('costOf prices every token kind of claude-opus-5-5', () => {
  const c = costOf({
    model: 'claude-opus-5-5',
    isFast: false,
    tokens: { input: MILLION, cacheWrite5m: MILLION, cacheWrite1h: MILLION, cacheRead: MILLION, output: MILLION },
  })
  expect(c).not.toBeNull()
  close(c!.input, 4)
  close(c!.cacheWrite, 13)
  close(c!.cacheRead, 0.2)
  close(c!.output, 20)
  close(c!.total, 37.2)
})

test('a model id with a suffix or a date prices like its table key', () => {
  const t = tokens({ input: MILLION })
  close(costOf({ model: 'claude-opus-5-5[1m]', isFast: false, tokens: t })!.input, 4)
  close(costOf({ model: 'claude-haiku-4-5-20251001', isFast: false, tokens: t })!.input, 1)
})

test('the longest table key wins', () => {
  const t = tokens({ input: MILLION })
  close(costOf({ model: 'claude-opus-5', isFast: false, tokens: t })!.input, 5)
  close(costOf({ model: 'claude-opus-5-5', isFast: false, tokens: t })!.input, 4)
  close(costOf({ model: 'claude-fable-5-1', isFast: false, tokens: tokens({ cacheRead: MILLION }) })!.cacheRead, 0.25)
  close(costOf({ model: 'claude-fable-5', isFast: false, tokens: tokens({ cacheRead: MILLION }) })!.cacheRead, 1)
})

test('claude-haiku-5-5 costs 5 times its rates above 100k input tokens', () => {
  const big = costOf({ model: 'claude-haiku-5-5', isFast: false, tokens: tokens({ input: 150_000 }) })!
  close(big.input, (150_000 / 1e6) * 0.5)
  const small = costOf({ model: 'claude-haiku-5-5', isFast: false, tokens: tokens({ input: 100_000 }) })!
  close(small.input, (100_000 / 1e6) * 0.1)
})

test('fast mode doubles the rates of claude-opus-5-5 and claude-opus-5 only', () => {
  const t = tokens({ output: MILLION })
  close(costOf({ model: 'claude-opus-5-5', isFast: true, tokens: t })!.output, 40)
  close(costOf({ model: 'claude-opus-5', isFast: true, tokens: t })!.output, 50)
  close(costOf({ model: 'claude-sonnet-5', isFast: true, tokens: t })!.output, 10)
})

test('an unknown or synthetic model has no cost', () => {
  expect(costOf({ model: '<synthetic>', isFast: false, tokens: tokens({ input: 5 }) })).toBeNull()
  expect(costOf({ model: 'gpt-x', isFast: false, tokens: tokens({ input: 5 }) })).toBeNull()
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
