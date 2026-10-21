import { expect, test } from 'claude-code/testing'

import { bar, contextTone, countdown, fiveHourTone, plain, resetTone, segments, tokens } from './format'

const at = (h: number, m: number) => new Date(2026, 9, 19, h, m)

test('tokens are shortened', () => {
  expect(tokens(612)).toBe('612')
  expect(tokens(61_400)).toBe('61k')
  expect(tokens(1_000_000)).toBe('1M')
})

test('countdown shows hours and minutes', () => {
  expect(countdown(82 * 60_000)).toBe('1h 22m')
  expect(countdown(5 * 60_000)).toBe('5m')
  expect(countdown(-1)).toBe('0m')
})

test('context size is green below 100k, yellow to 150k, red above', () => {
  expect(contextTone(99_999)).toBe('success')
  expect(contextTone(100_000)).toBe('warning')
  expect(contextTone(150_000)).toBe('warning')
  expect(contextTone(150_001)).toBe('error')
})

test('5-hour window is green below 70%, yellow to 90%, red above', () => {
  expect(fiveHourTone(69.9)).toBe('success')
  expect(fiveHourTone(70)).toBe('warning')
  expect(fiveHourTone(90)).toBe('warning')
  expect(fiveHourTone(90.1)).toBe('error')
})

test('time left is red at 30 minutes or less', () => {
  expect(resetTone(31 * 60_000)).toBe('success')
  expect(resetTone(30 * 60_000)).toBe('error')
})

test('size leads, percentage follows in parentheses', () => {
  const parts = segments(
    { contextTokens: 61_000, contextPercent: 31, fiveHourPercent: 42, fiveHourResetsAt: at(15, 10).toISOString() },
    at(13, 48).getTime(),
  )

  expect(plain(parts)).toBe('📚 61k (31%) ┊ ████▎░░░░░ 42% 🔔 15:10 (1h 22m)')
  expect(parts.find(p => p.text === '61k')).toEqual({ text: '61k', tone: 'success', isBold: true })
  expect(parts.find(p => p.text === ' (31%)')?.isDim).toBe(true)
})

test('no reading yet', () => {
  expect(plain(segments({ contextTokens: null, contextPercent: null, fiveHourPercent: null, fiveHourResetsAt: null }, 0))).toBe('📚 –')
})

test('the bar fills in eighths of a cell and keeps its width', () => {
  expect(bar(0)).toEqual({ filled: '', empty: '░░░░░░░░░░' })
  expect(bar(42)).toEqual({ filled: '████▎', empty: '░░░░░' })
  expect(bar(45)).toEqual({ filled: '████▌', empty: '░░░░░' })
  expect(bar(100)).toEqual({ filled: '██████████', empty: '' })
  expect(bar(130)).toEqual({ filled: '██████████', empty: '' })
})
