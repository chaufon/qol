export const ACCENT = 'planMode'
export const TYPE_WIDTH = 15
export const BAR_WIDTH = 10
/**
 * The columns of a Top mistakes row besides the mistake and the count: the open mark, the rank, the icon, the type, the
 * gaps and the bar ("▾  3 ∅ Missing subject  <mistake> ██████░░░░ <count>").
 */
const ROW_FIXED = 1 + 3 + 1 + 1 + 1 + TYPE_WIDTH + 2 + 1 + BAR_WIDTH + 1

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Cuts a cell to its column width with an ellipsis, or pads it to that width. */
export function cell(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width)
}

/** The width of the Count column in a Top mistakes row: the digits of the largest count. */
export function countColumn(largest: number): number {
  return String(largest).length
}

/** The width of the Mistake column in a Top mistakes row, so the row fits the pane on one line. */
export function mistakeColumn(paneWidth: number, largest: number): number {
  return Math.max(8, paneWidth - ROW_FIXED - countColumn(largest))
}

/** One single-width glyph and one theme color per mistake type; a type with none uses the "other" ones. */
const OTHER_ICON = '•'
const OTHER_COLOR = 'inactive'
const TYPE_ICONS: Partial<Record<string, string>> = {
  spelling: '✎',
  irregular_verb: '↯',
  phrasal_verb: '⇢',
  wrong_tense: '◷',
  malformed_tense: '◴',
  word_order: '⇅',
  native_expression: '❝',
  preposition: '⇄',
  article: 'ª',
  agreement: '≡',
  word_choice: '≈',
  false_friend: '⚑',
  countability: '#',
  missing_subject: '∅',
  verb_pattern: '→',
  question_form: '?',
  pronoun: '¶',
  other: OTHER_ICON,
}
const TYPE_COLORS: Partial<Record<string, string>> = {
  spelling: 'error',
  irregular_verb: 'remember',
  phrasal_verb: 'permission',
  wrong_tense: 'ide',
  malformed_tense: 'ide',
  word_order: 'autoAccept',
  native_expression: 'claude',
  preposition: 'suggestion',
  article: 'error',
  agreement: 'merged',
  word_choice: 'remember',
  false_friend: 'warning',
  countability: 'planMode',
  missing_subject: 'warning',
  verb_pattern: 'permission',
  question_form: 'suggestion',
  pronoun: 'claude',
  other: OTHER_COLOR,
}

export function typeIcon(type: string): string {
  return TYPE_ICONS[type] ?? OTHER_ICON
}

export function typeColor(type: string): string {
  return TYPE_COLORS[type] ?? OTHER_COLOR
}

/** Five dots that fill as a mistake repeats: 1 and 2 times, 3 and 4, 5 to 9, 10 or more. */
export function meter(count: number): string {
  const filled = Math.min(5, count < 3 ? count : count < 5 ? 3 : count < 10 ? 4 : 5)
  return '●'.repeat(filled) + '○'.repeat(5 - filled)
}

/** A bar of BAR_WIDTH cells in which `count` fills its share of `largest`, and at least one cell. */
export function barFill(count: number, largest: number): number {
  return Math.min(BAR_WIDTH, Math.max(1, Math.round((count / largest) * BAR_WIDTH)))
}

/**
 * The cells of a bar of `cells` cells that each count fills by its share of the sum, at least one cell each, and as many
 * cells as the bar has in all. A count with no cell left is dropped.
 */
export function shareCells(counts: number[], cells: number): number[] {
  const kept = counts.slice(0, cells)
  const total = kept.reduce((sum, n) => sum + n, 0)
  if (total === 0) return []
  const exact = kept.map(n => (n / total) * cells)
  const widths = exact.map(x => Math.max(1, Math.floor(x)))
  const shortfall = (i: number) => (exact[i] ?? 0) - (widths[i] ?? 0)
  let used = widths.reduce((sum, n) => sum + n, 0)
  while (used < cells) {
    const n = widths.reduce((best, _, i) => (shortfall(i) > shortfall(best) ? i : best), 0)
    widths[n] = (widths[n] ?? 0) + 1
    used++
  }
  while (used > cells) {
    const n = widths.reduce((best, w, i) => (w > 1 && (best < 0 || -shortfall(i) > -shortfall(best)) ? i : best), -1)
    if (n < 0) break
    widths[n] = (widths[n] ?? 0) - 1
    used--
  }
  return widths
}

const SPARK = '▁▂▃▄▅▆▇█'

/** One block per count, as tall as its share of the largest; 0 is the lowest block. */
export function sparkline(counts: number[]): string[] {
  const largest = Math.max(1, ...counts)
  return counts.map(n => SPARK.charAt(n === 0 ? 0 : Math.min(7, Math.max(1, Math.round((n / largest) * 7)))))
}

/** The prompts without a mistake at the end of the trend. */
export function cleanStreak(counts: number[]): number {
  let streak = 0
  while (streak < counts.length && counts[counts.length - 1 - streak] === 0) streak++
  return streak
}
