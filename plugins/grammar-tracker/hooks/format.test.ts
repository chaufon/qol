import { expect, test } from 'claude-code/testing'

import {
  barFill,
  cell,
  cleanStreak,
  countColumn,
  meter,
  mistakeColumn,
  shareCells,
  sparkline,
  typeColor,
  typeIcon,
} from './format'
import { mascotRows } from './mascot'

test('cell cuts or pads a table cell and the Count column fits the largest count', () => {
  expect(cell('article', 4)).toBe('art…')
  expect(cell('the', 5)).toBe('the  ')
  expect(countColumn(7)).toBe(1)
  expect(countColumn(123456)).toBe(6)
})

test('a Top mistakes row with the largest count fits the pane', () => {
  for (const largest of [7, 68, 512, 123456]) {
    const mistake = cell('the', mistakeColumn(80, largest))
    const row = `▾${'10'.padStart(3)} ª ${cell('Article', 15)}  ${mistake} ${'█'.repeat(10)} ${String(largest).padStart(countColumn(largest))}`
    expect(row.length).toBe(80)
  }
})

test('meter, barFill, sparkline and cleanStreak scale a count', () => {
  expect([1, 2, 3, 4, 5, 9, 10, 59].map(meter)).toEqual([
    '●○○○○',
    '●●○○○',
    '●●●○○',
    '●●●○○',
    '●●●●○',
    '●●●●○',
    '●●●●●',
    '●●●●●',
  ])
  expect([barFill(59, 59), barFill(1, 59), barFill(30, 59)]).toEqual([10, 1, 5])
  expect(sparkline([0, 1, 4, 8])).toEqual(['▁', '▂', '▅', '█'])
  expect(sparkline([0, 0])).toEqual(['▁', '▁'])
  expect([cleanStreak([1, 0, 0]), cleanStreak([0, 2]), cleanStreak([]), cleanStreak([0, 0])]).toEqual([2, 0, 0, 2])
})

test('every mistake type has an icon and a color, and an unknown type uses the "other" ones', () => {
  expect(typeIcon('article')).toBe('ª')
  expect(typeIcon('pronoun')).not.toBe(typeIcon('other'))
  expect(typeColor('pronoun')).not.toBe(typeColor('other'))
  expect(typeIcon('nope')).toBe(typeIcon('other'))
  expect(typeColor('nope')).toBe(typeColor('other'))
})

test('the mascot is four rows of ten cells, and its mouth turns down when worried', () => {
  const text = (rows: ReturnType<typeof mascotRows>) => rows.map(row => row.map(run => run.text).join(''))
  const happy = mascotRows('happy')
  expect(happy.length).toBe(4)
  expect(text(happy).map(row => row.length)).toEqual([10, 10, 10, 10])
  expect(text(mascotRows('worried'))).not.toEqual(text(happy))
})

test('shareCells splits a bar by share, one cell at least, and fills the bar', () => {
  expect(shareCells([3, 1], 8)).toEqual([6, 2])
  expect(shareCells([59, 31, 22, 17, 12, 9, 6, 4], 68).reduce((a, b) => a + b, 0)).toBe(68)
  expect(shareCells([100, 1, 1], 10)).toEqual([8, 1, 1])
  expect(shareCells([1, 1, 1], 2)).toEqual([1, 1])
  expect(shareCells([], 10)).toEqual([])
})
