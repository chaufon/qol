import { expect, test } from 'claude-code/testing'

import { RECENT_WIDTH, barFill, cell, countColumn, meter, rowColumns, typeColor, typeIcon, wordDiff } from './format'

test('cell cuts or pads a table cell and the Count column fits the largest count', () => {
  expect(cell('article', 4)).toBe('art…')
  expect(cell('the', 5)).toBe('the  ')
  expect(countColumn(7)).toBe(1)
  expect(countColumn(123456)).toBe(6)
})

test('a Top mistakes row with the largest count fits the pane, the Type column narrowing first', () => {
  for (const width of [80, 48]) {
    for (const largest of [7, 68, 512, 123456]) {
      const columns = rowColumns(width, largest)
      const count = String(largest).padStart(countColumn(largest))
      const row = `▾${'10'.padStart(3)} ª ${cell('Missing subject', columns.type)}  ${cell('the', columns.mistake)} ${'█'.repeat(10)} ${count}${'+25'.padStart(RECENT_WIDTH)}`
      expect(row.length).toBe(width)
    }
  }
  expect(rowColumns(80, 146)).toEqual({ type: 15, mistake: 37 })
  expect(rowColumns(48, 146)).toEqual({ type: 12, mistake: 8 })
})

test('meter and barFill scale a count', () => {
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
})

test('every mistake type has an icon and a color, and an unknown type uses the "other" ones', () => {
  expect(typeIcon('article')).toBe('ª')
  expect(typeIcon('pronoun')).not.toBe(typeIcon('other'))
  expect(typeColor('pronoun')).not.toBe(typeColor('other'))
  expect(typeIcon('nope')).toBe(typeIcon('other'))
  expect(typeColor('nope')).toBe(typeColor('other'))
})

/** A diffed sentence written with the changed runs in brackets. */
const marked = (parts: { text: string; isChanged: boolean }[]) =>
  parts.map(part => (part.isChanged ? `[${part.text}]` : part.text)).join('')

test('wordDiff marks the words a correction changed, and not case or punctuation at their ends', () => {
  const diff = wordDiff(
    'update the marketplace qol and all their pluggins',
    'Update the qol marketplace and all its plugins.',
  )
  expect(marked(diff.wrong)).toBe('update the [marketplace] qol and all [their pluggins]')
  expect(marked(diff.corrected)).toBe('Update the qol [marketplace] and all [its plugins.]')
})

test('wordDiff keeps spaces out of the edges of a highlight', () => {
  expect(marked(wordDiff('commit changes into main', 'commit the changes to main').corrected)).toBe(
    'commit [the] changes [to] main',
  )
  expect(marked(wordDiff('same words', 'same words').wrong)).toBe('same words')
})
