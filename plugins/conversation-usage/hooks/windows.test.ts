import { expect, test } from 'claude-code/testing'

import type { Window } from '../types'
import { WINDOW_MS, currentWindows, observe } from './windows'

const H = 3_600_000
const at = (hour: number) => Date.UTC(2026, 9, 28, hour)
const iso = (hour: number) => new Date(at(hour)).toISOString()

const five = (start: number, end: number, percentUsed: number): Window => ({ kind: 'five_hour', start, end, percentUsed })
const seven = (start: number, end: number, percentUsed: number): Window => ({ kind: 'seven_day', start, end, percentUsed })

test('window lengths are 5 hours and 7 days', () => {
  expect(WINDOW_MS.five_hour).toBe(5 * H)
  expect(WINDOW_MS.seven_day).toBe(7 * 24 * H)
})

test('a first reading opens a window ending at resetsAt', () => {
  const out = observe([], { kind: 'five_hour', percentUsed: 20, resetsAt: iso(17) }, at(13))
  expect(out).toEqual([five(at(12), at(17), 20)])
})

test('the same reading again changes nothing', () => {
  const stored = [five(at(12), at(17), 20)]
  expect(observe(stored, { kind: 'five_hour', percentUsed: 20, resetsAt: iso(17) }, at(13))).toEqual([])
})

test('a new percentage with the same end updates the window', () => {
  const stored = [five(at(12), at(17), 20)]
  const out = observe(stored, { kind: 'five_hour', percentUsed: 35, resetsAt: iso(17) }, at(13))
  expect(out).toEqual([five(at(12), at(17), 35)])
})

test('a later resetsAt at higher usage moves the end', () => {
  const stored = [five(at(12), at(17), 30)]
  const out = observe(stored, { kind: 'five_hour', percentUsed: 40, resetsAt: iso(18) }, at(14))
  expect(out).toEqual([five(at(12), at(18), 40)])
})

test('a drop to near zero with a new end closes the old window and opens a new one', () => {
  const stored = [five(at(12), at(17), 60)]
  const out = observe(stored, { kind: 'five_hour', percentUsed: 0, resetsAt: iso(19) }, at(14))
  expect(out).toEqual([five(at(12), at(14), 60), five(at(14), at(19), 0)])
})

test('a first reading never starts before the end of an earlier window', () => {
  const stored = [five(at(6), at(9), 50)]
  const out = observe(stored, { kind: 'five_hour', percentUsed: 5, resetsAt: iso(12) }, at(10))
  expect(out).toEqual([five(at(9), at(12), 5)])
})

test('unknown kinds, missing and unparsable resetsAt are ignored', () => {
  expect(observe([], { kind: 'spend_limit', percentUsed: 5, resetsAt: iso(17) }, at(13))).toEqual([])
  expect(observe([], { kind: 'five_hour', percentUsed: 5 }, at(13))).toEqual([])
  expect(observe([], { kind: 'five_hour', percentUsed: 5, resetsAt: 'soon' }, at(13))).toEqual([])
})

test('windows of one kind do not affect the other', () => {
  const stored = [seven(at(0), at(0) + 7 * 24 * H, 10)]
  const out = observe(stored, { kind: 'five_hour', percentUsed: 20, resetsAt: iso(17) }, at(13))
  expect(out).toEqual([five(at(12), at(17), 20)])
})

test('currentWindows returns the windows containing now, five-hour first', () => {
  const stored = [
    seven(at(0), at(0) + 7 * 24 * H, 10),
    five(at(6), at(9), 50),
    five(at(12), at(17), 20),
  ]
  expect(currentWindows(stored, at(13))).toEqual([five(at(12), at(17), 20), seven(at(0), at(0) + 7 * 24 * H, 10)])
  expect(currentWindows(stored, at(10))).toEqual([seven(at(0), at(0) + 7 * 24 * H, 10)])
})

test('a reading that ends at or before now with no live window is ignored', () => {
  expect(observe([], { kind: 'five_hour', percentUsed: 5, resetsAt: iso(13) }, at(13))).toEqual([])
  expect(observe([], { kind: 'five_hour', percentUsed: 5, resetsAt: iso(12) }, at(13))).toEqual([])
  const stored = [five(at(6), at(9), 50)]
  expect(observe(stored, { kind: 'five_hour', percentUsed: 5, resetsAt: iso(10) }, at(11))).toEqual([])
})

test('a drop to 1 % or less with a different end is a reset; a larger drop is a move', () => {
  const stored = [five(at(12), at(17), 60)]
  expect(observe(stored, { kind: 'five_hour', percentUsed: 1, resetsAt: iso(19) }, at(14))).toEqual([
    five(at(12), at(14), 60), five(at(14), at(19), 1),
  ])
  expect(observe(stored, { kind: 'five_hour', percentUsed: 1.5, resetsAt: iso(19) }, at(14))).toEqual([
    five(at(12), at(19), 1.5),
  ])
})
