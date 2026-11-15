export const ACCENT = 'planMode'
export const BAR_WIDTH = 10
/** The widest and the narrowest Type column of a Top mistakes row, and the narrowest Mistake column. */
const TYPE_WIDTH = 15
const MIN_TYPE = 6
const MIN_MISTAKE = 8
/** The column of a Top mistakes row that counts the mistake's occurrences in the last 7 days (" +25"). */
export const RECENT_WIDTH = 4
/**
 * The columns of a Top mistakes row besides the type, the mistake and the count: the open mark, the rank, the icon, the
 * gaps, the bar and the last 7 days ("▸  3 ∅ <type>  <mistake> ██████░░░░ <count> +25").
 */
const ROW_FIXED = 1 + 3 + 1 + 1 + 1 + 2 + 1 + BAR_WIDTH + 1 + RECENT_WIDTH

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

/**
 * The widths of the Type and Mistake columns of a Top mistakes row, so the row fits the pane on one line. The Mistake
 * column takes the room left; in a narrow pane the Type column gives up cells before the Mistake column goes under its
 * narrowest.
 */
export function rowColumns(paneWidth: number, largest: number): { type: number; mistake: number } {
  const room = paneWidth - ROW_FIXED - countColumn(largest)
  const type = Math.max(MIN_TYPE, Math.min(TYPE_WIDTH, room - MIN_MISTAKE))
  return { type, mistake: Math.max(MIN_MISTAKE, room - type) }
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

/** A run of a sentence: words that differ from the other sentence of a correction have `isChanged`. */
export interface Segment {
  text: string
  isChanged: boolean
}

/** A word as the comparison sees it: lower case, without punctuation at its ends. */
function wordKey(word: string): string {
  return word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

/** The indexes of the words of `a` and of `b` in their longest common subsequence. */
function commonWords(a: string[], b: string[]): [Set<number>, Set<number>] {
  const lengths = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  const at = (i: number, j: number) => lengths[i]?.[j] ?? 0
  for (let i = a.length - 1; i >= 0; i--) {
    const row = lengths[i] ?? []
    for (let j = b.length - 1; j >= 0; j--)
      row[j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))
  }
  const inA = new Set<number>()
  const inB = new Set<number>()
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      inA.add(i++)
      inB.add(j++)
    } else if (at(i + 1, j) >= at(i, j + 1)) i++
    else j++
  }
  return [inA, inB]
}

function segments(sentence: string, kept: Set<number>): Segment[] {
  const tokens = sentence.match(/\s+|\S+/g) ?? []
  let word = 0
  const states = tokens.map(token => (/^\s/.test(token) ? undefined : !kept.has(word++)))
  const result: Segment[] = []
  tokens.forEach((text, n) => {
    // A space is changed only between two changed words, so a highlight never ends in a space.
    const isChanged = states[n] ?? (states[n - 1] === true && states[n + 1] === true)
    const previous = result.at(-1)
    if (previous?.isChanged === isChanged) previous.text += text
    else result.push({ text, isChanged })
  })
  return result
}

/**
 * The wrong and the corrected sentence of a mistake, each split into runs, with the words the correction changed
 * marked. Case and punctuation at the ends of a word do not count as a change.
 */
export function wordDiff(wrong: string, corrected: string): { wrong: Segment[]; corrected: Segment[] } {
  const words = (sentence: string) => (sentence.match(/\S+/g) ?? []).map(wordKey)
  const [inWrong, inCorrected] = commonWords(words(wrong), words(corrected))
  return { wrong: segments(wrong, inWrong), corrected: segments(corrected, inCorrected) }
}
