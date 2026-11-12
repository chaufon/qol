import { expect, test } from 'claude-code/testing'

import { parsePricingPage } from './pricing-page'

// The parts of the pricing page the parser reads, in its own layout.
const PAGE = `---
title: Pricing
---

## Model pricing

The following table shows pricing for all Claude models:

| Model | Base input tokens | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens |
| :---- | :---------------- | :-------------- | :-------------- | :----------------------- | :------------ |
| Claude Fable 5.2 | $8 / MTok | $10 / MTok | $16 / MTok | $0.20 / MTok<sup>1</sup> | $40 / MTok |
| Claude Mythos 5.2 ([limited availability](https://support.claude.com/en/articles/14604842)) | $8 / MTok | $10 / MTok | $16 / MTok | $0.20 / MTok<sup>1</sup> | $40 / MTok |
| Claude Opus 5.5 | $4 / MTok | $5 / MTok | $8 / MTok | $0.20 / MTok<sup>2</sup> | $20 / MTok |
| Claude Opus 5 | $5 / MTok | $6.25 / MTok | $10 / MTok | $0.50 / MTok | $25 / MTok |
| Claude Opus 4.1 ([retired, except on Bedrock](https://platform.claude.com/docs/en/about-claude/model-deprecations)) | $15 / MTok | $18.75 / MTok | $30 / MTok | $1.50 / MTok | $75 / MTok |
| Claude Sonnet 5 | $2 / MTok<sup>3</sup> | $2.50 / MTok | $4 / MTok | $0.20 / MTok | $10 / MTok<sup>3</sup> |
| Claude Haiku 5.5 (for prompts up to 100,000 tokens) | $0.10 / MTok | $0.125 / MTok | $0.20 / MTok | $0.01 / MTok | $0.50 / MTok |
| Claude Haiku 5.5 (for prompts over 100,000 tokens) | $0.50 / MTok | $0.625 / MTok | $1 / MTok | $0.05 / MTok | $2.50 / MTok |
| Claude Mythos Preview | $25 / MTok | $31.25 / MTok | $50 / MTok | $2.50 / MTok | $125 / MTok |

## Cloud platform pricing

| Model | Input |
| ----- | ----- |
| Claude Opus 5.5 | $99 / MTok |

### Fast mode pricing

| Model                           | Input          | Output         |
| ------------------------------- | -------------- | -------------- |
| Claude Fable 5.2                | $16 USD / MTok | $80 USD / MTok |
| Claude Opus 5.5                 | $8 USD / MTok  | $40 USD / MTok |
| Claude Opus 5 / Claude Opus 4.8 | $10 USD / MTok | $50 USD / MTok |

### Batch processing
`

test('the model table gives one row per model id, in page order', () => {
  const rows = parsePricingPage(PAGE, 42)
  expect(Array.isArray(rows)).toBe(true)
  if (!Array.isArray(rows)) return
  expect(rows.map((r) => r.model)).toEqual([
    'claude-fable-5-2', 'claude-mythos-5-2', 'claude-opus-5-5', 'claude-opus-5', 'claude-opus-4-1', 'claude-sonnet-5', 'claude-haiku-5-5',
  ])
  expect(rows.every((r) => r.since === 42)).toBe(true)
  expect(rows[2]!.rates).toEqual({ input: 4, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2, output: 20 })
  expect(rows[4]!.rates.cacheWrite5m).toBe(18.75)
})

test('a model priced by prompt length gets its long-context rates', () => {
  const rows = parsePricingPage(PAGE, 0)
  if (!Array.isArray(rows)) throw new Error('parse failed')
  const haiku = rows.find((r) => r.model === 'claude-haiku-5-5')!
  expect(haiku.rates.input).toBe(0.1)
  expect(haiku.longAbove).toBe(100_000)
  expect(haiku.longRates).toEqual({ input: 0.5, cacheWrite5m: 0.625, cacheWrite1h: 1, cacheRead: 0.05, output: 2.5 })
  expect(rows.find((r) => r.model === 'claude-opus-5')!.longRates).toBeNull()
})

test('the fast mode table sets a factor on the models it names that the model table lists', () => {
  const rows = parsePricingPage(PAGE, 0)
  if (!Array.isArray(rows)) throw new Error('parse failed')
  const factor = (m: string) => rows.find((r) => r.model === m)?.fastFactor
  expect(factor('claude-fable-5-2')).toBe(2)
  expect(factor('claude-opus-5-5')).toBe(2)
  expect(factor('claude-opus-5')).toBe(2)
  expect(factor('claude-sonnet-5')).toBeNull()
  expect(rows.some((r) => r.model === 'claude-opus-4-8')).toBe(false)
})

test('a page without the model table is an error', () => {
  expect(parsePricingPage('# Pricing\n\nNothing here.', 0)).toEqual({ error: 'The pricing page lists 0 models in a form this mod reads' })
  expect('error' in (parsePricingPage(PAGE.replace('## Model pricing', '## Prices'), 0) as object)).toBe(true)
})
