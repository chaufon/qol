/** What the icon's last square says: the prompt is clean, or it has mistakes. */
export type Verdict = 'right' | 'wrong'
export interface Run {
  text: string
  color?: string
  backgroundColor?: string
  isBold?: boolean
}

/** Union Jack red and white, with a blue light enough to read on a dark terminal. */
const RED = '#C8102E'
const BLUE = '#2453C6'
const WHITE = '#FFFFFF'
/** The verdict square: near white, so it still shows on a light terminal. */
const PAPER = '#DDDDDD'
const UNDECIDED = '#777777'

/**
 * How long each step of the flip after a check lands shows before the next, in milliseconds: "?", then the square
 * edge-on in gray and in white. The step after them, LAST_STEP, is the verdict, and stays.
 */
export const FLIP_MS = [500, 90, 90] as const
export const LAST_STEP = FLIP_MS.length

const MARKS: Record<Verdict, { text: string; color: string }> = {
  right: { text: '✓', color: BLUE },
  wrong: { text: '✗', color: RED },
}

/** A square of three cells by three rows: half blocks on top and bottom, the letter on its color in the middle. */
function square(letter: string, color: string, letterColor: string): Run[] {
  return [
    { text: '▄▄▄', color },
    { text: ` ${letter} `, color: letterColor, backgroundColor: color, isBold: true },
    { text: '▀▀▀', color },
  ]
}

/** A square seen edge-on, mid flip: one thin bar across the middle row. */
function edgeOn(color: string): Run[] {
  return [{ text: '   ' }, { text: '▄▄▄', color }, { text: '   ' }]
}

function lastSquare(verdict: Verdict, step: number): Run[] {
  if (step <= 0) return square('?', UNDECIDED, WHITE)
  if (step === 1) return edgeOn(UNDECIDED)
  if (step === 2) return edgeOn(PAPER)
  const mark = MARKS[verdict]
  return square(mark.text, PAPER, mark.color)
}

/**
 * The icon as three text rows: a red E and a blue N square, then the verdict square, a blue ✓ or a red ✗ on white. The
 * squares run red, blue, white, so no two neighbors share a color. `step` is the flip after a check lands, from 0 ("?")
 * to LAST_STEP (the verdict).
 */
export function iconRows(verdict: Verdict, step: number = LAST_STEP): Run[][] {
  const squares = [square('E', RED, WHITE), square('N', BLUE, WHITE), lastSquare(verdict, step)]
  return [0, 1, 2].map(row =>
    squares.flatMap((parts, n) => {
      const part = parts[row] ?? { text: '   ' }
      return n === 0 ? [part] : [{ text: ' ' }, part]
    }),
  )
}
