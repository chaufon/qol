import { expect, test } from 'claude-code/testing'

import { COLORS, dayLabel, fmtCost, fmtPrice, fmtTokens, PROJECT_PALETTE, projectColor, projectLabel } from './format'

test('fmtTokens shortens counts', () => {
  expect(fmtTokens(0)).toBe('0')
  expect(fmtTokens(12)).toBe('12')
  expect(fmtTokens(999)).toBe('999')
  expect(fmtTokens(1_000)).toBe('1.0k')
  expect(fmtTokens(18_400)).toBe('18.4k')
  expect(fmtTokens(372_300)).toBe('372.3k')
  expect(fmtTokens(3_100_000)).toBe('3.1M')
  expect(fmtTokens(46_900_000)).toBe('46.9M')
  expect(fmtTokens(999_949)).toBe('999.9k')
  expect(fmtTokens(999_950)).toBe('1.0M')
  expect(fmtTokens(999_999)).toBe('1.0M')
})

test('fmtPrice shows two decimals, or three when the third is not 0', () => {
  expect(fmtPrice(10)).toBe('$10.00')
  expect(fmtPrice(0.3)).toBe('$0.30')
  expect(fmtPrice(0.125)).toBe('$0.125')
  expect(fmtPrice(0.01)).toBe('$0.01')
})

test('fmtCost shows dollars with two decimals, or ? when unknown', () => {
  expect(fmtCost(0.744)).toBe('$0.74')
  expect(fmtCost(0)).toBe('$0.00')
  expect(fmtCost(75.514)).toBe('$75.51')
  expect(fmtCost(null)).toBe('?')
})

test('dayLabel names today, yesterday, then the weekday and date', () => {
  const now = new Date(2026, 9, 28, 15, 30).getTime()
  expect(dayLabel(new Date(2026, 9, 28, 0, 5).getTime(), now)).toBe('Today · Wed 28 Oct')
  expect(dayLabel(new Date(2026, 9, 27, 23, 59).getTime(), now)).toBe('Yesterday · Tue 27 Oct')
  expect(dayLabel(new Date(2026, 9, 26, 12, 0).getTime(), now)).toBe('Mon 26 Oct')
})

test('projectLabel is the last folder of the path', () => {
  expect(projectLabel('/home/centos/PycharmProjects/claude/qol')).toBe('qol')
})

test('projectColor is stable and taken from the palette', () => {
  const p = '/home/centos/PycharmProjects/claude/qol'
  expect(projectColor(p)).toBe(projectColor(p))
  expect(PROJECT_PALETTE).toContain(projectColor(p))
  expect(PROJECT_PALETTE).toContain(projectColor('/tmp/other'))
})

test('COLORS holds the style table', () => {
  expect(COLORS.input).toBe('#61afef')
  expect(COLORS.dim).toBe('#7f848e')
})
