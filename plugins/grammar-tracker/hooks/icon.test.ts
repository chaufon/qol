import { expect, test } from 'claude-code/testing'

import { FLIP_MS, LAST_STEP, iconRows } from './icon'
import type { Run } from './icon'

const text = (rows: Run[][]) => rows.map(row => row.map(run => run.text).join(''))
/** The background colors of the middle row, left to right: one per square. */
const squareColors = (rows: Run[][]) =>
  (rows[1] ?? []).flatMap(run => (run.backgroundColor === undefined ? [] : [run.backgroundColor]))

test('the icon is three rows of eleven cells: E, N and a ✓ or ✗', () => {
  const right = iconRows('right')
  expect(text(right)).toEqual(['▄▄▄ ▄▄▄ ▄▄▄', ' E   N   ✓ ', '▀▀▀ ▀▀▀ ▀▀▀'])
  expect(text(iconRows('wrong'))[1]).toBe(' E   N   ✗ ')
})

test('the squares run red, blue, near white, so no two neighbors share a color', () => {
  for (const verdict of ['right', 'wrong'] as const) {
    const colors = squareColors(iconRows(verdict))
    expect(colors).toEqual(['#C8102E', '#2453C6', '#DDDDDD'])
  }
})

test('the ✓ is blue and the ✗ is red', () => {
  const mark = (rows: Run[][]) => rows[1]?.find(run => /[✓✗]/.test(run.text))?.color
  expect(mark(iconRows('right'))).toBe('#2453C6')
  expect(mark(iconRows('wrong'))).toBe('#C8102E')
})

test('the flip shows "?", the square edge-on twice, then the verdict', () => {
  expect(LAST_STEP).toBe(FLIP_MS.length)
  expect(text(iconRows('wrong', 0))[1]).toBe(' E   N   ? ')
  expect(text(iconRows('wrong', 1))).toEqual(['▄▄▄ ▄▄▄    ', ' E   N  ▄▄▄', '▀▀▀ ▀▀▀    '])
  expect(text(iconRows('wrong', 2))).toEqual(text(iconRows('wrong', 1)))
  expect(text(iconRows('wrong', LAST_STEP))).toEqual(text(iconRows('wrong')))
})
