import { expect, test } from 'claude-code/testing'

import { bar, contextTone, countdown, plain, resetTone, segments, sevenDay, tokens, windowTone } from './format'

const at = (h: number, m: number) => new Date(2026, 9, 19, h, m)

const EMPTY = {
  contextTokens: null,
  contextPercent: null,
  fiveHourPercent: null,
  fiveHourResetsAt: null,
  sevenDayPercent: null,
  sevenDayResetsAt: null,
}

test('tokens are shortened', () => {
  expect(tokens(612)).toBe('612')
  expect(tokens(61_400)).toBe('61k')
  expect(tokens(1_000_000)).toBe('1M')
})

test('countdown shows days and hours, or hours and minutes', () => {
  expect(countdown((3 * 24 + 4) * 60 * 60_000)).toBe('3d 4h')
  expect(countdown(24 * 60 * 60_000)).toBe('1d 0h')
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

test('a rate-limit window is green below 70%, yellow to 90%, red above', () => {
  expect(windowTone(69.9)).toBe('success')
  expect(windowTone(70)).toBe('warning')
  expect(windowTone(90)).toBe('warning')
  expect(windowTone(90.1)).toBe('error')
})

test('time left is red at 30 minutes or less', () => {
  expect(resetTone(31 * 60_000)).toBe('success')
  expect(resetTone(30 * 60_000)).toBe('error')
})

test('size leads, percentage follows in parentheses', () => {
  const parts = segments(
    { ...EMPTY, contextTokens: 61_000, contextPercent: 31, fiveHourPercent: 42, fiveHourResetsAt: at(15, 10).toISOString() },
    at(13, 48).getTime(),
  )

  expect(plain(parts)).toBe('📚 61k (31%) ┊ ████▎░░░░░ 42% 🔔 15:10 (1h 22m)')
  expect(parts.find(p => p.text === '61k')).toEqual({ text: '61k', tone: 'success', isBold: true })
  expect(parts.find(p => p.text === ' (31%)')?.isDim).toBe(true)
})

test('no reading yet', () => {
  expect(plain(segments(EMPTY, 0))).toBe('📚 –')
  expect(sevenDay(EMPTY, 0)).toBeNull()
})

test('the 7-day window follows a separator as a battery and its percentage', () => {
  const resetsAt = new Date(2026, 9, 22, 14, 30).toISOString()
  const week = sevenDay({ ...EMPTY, sevenDayPercent: 91.6, sevenDayResetsAt: resetsAt }, at(10, 0).getTime())

  expect(plain(week?.parts ?? [])).toBe(' ┊ 🔋 92%')
  expect(week?.parts.find(p => p.text === '92%')).toEqual({ text: '92%', tone: 'error', isBold: true })
  expect(week?.card).toBe('Resets Thu 14:30 (3d 4h)')
})

test('a 7-day window without a reset time has no card', () => {
  expect(sevenDay({ ...EMPTY, sevenDayPercent: 12 }, 0)).toEqual({
    parts: [
      { text: ' ┊ ', isDim: true },
      { text: '🔋 ', isDim: true },
      { text: '12%', tone: 'success', isBold: true },
    ],
    card: null,
  })
})

test('the bar fills in eighths of a cell and keeps its width', () => {
  expect(bar(0)).toEqual({ filled: '', empty: '░░░░░░░░░░' })
  expect(bar(42)).toEqual({ filled: '████▎', empty: '░░░░░' })
  expect(bar(45)).toEqual({ filled: '████▌', empty: '░░░░░' })
  expect(bar(100)).toEqual({ filled: '██████████', empty: '' })
  expect(bar(130)).toEqual({ filled: '██████████', empty: '' })
})
