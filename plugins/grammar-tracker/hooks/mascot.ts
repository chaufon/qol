import { ACCENT } from './format'

export type Mood = 'happy' | 'worried'
export interface Run {
  text: string
  color?: string
  backgroundColor?: string
}

/** The mascot, 10 pixels wide: X is the body, D a dark pixel (eyes and mouth), . nothing. */
const MASCOT: Record<Mood, string[]> = {
  happy: [
    '.XXXXXXXX.',
    'XXXXXXXXXX',
    'XXDXXXXDXX',
    'XXDXXXXDXX',
    'XXXXXXXXXX',
    'XDXXXXXXDX',
    'XXDDDDDDXX',
    '.XX....XX.',
  ],
  worried: [
    '.XXXXXXXX.',
    'XXXXXXXXXX',
    'XXDXXXXDXX',
    'XXDXXXXDXX',
    'XXXXXXXXXX',
    'XXDDDDDDXX',
    'XDXXXXXXDX',
    '.XX....XX.',
  ],
}
const PIXEL_COLORS: Partial<Record<string, string>> = { X: ACCENT, D: 'inverseText' }

function pixelRun(top: string | undefined, bottom: string | undefined): Run {
  if (!top && !bottom) return { text: ' ' }
  if (top === bottom) return { text: '█', color: top }
  if (!bottom) return { text: '▀', color: top }
  if (!top) return { text: '▄', color: bottom }
  return { text: '▀', color: top, backgroundColor: bottom }
}

/**
 * The mascot as text rows: every row of cells draws two rows of pixels with half blocks, and neighbors of one color
 * are one run.
 */
export function mascotRows(mood: Mood): Run[][] {
  const pixels = MASCOT[mood]
  const rows: Run[][] = []
  for (let y = 0; y < pixels.length; y += 2) {
    const upper = pixels[y] ?? ''
    const lower = pixels[y + 1] ?? ''
    const runs: Run[] = []
    for (let x = 0; x < upper.length; x++) {
      const run = pixelRun(PIXEL_COLORS[upper.charAt(x)], PIXEL_COLORS[lower.charAt(x)])
      const previous = runs.at(-1)
      if (previous && previous.color === run.color && previous.backgroundColor === run.backgroundColor) {
        previous.text += run.text
      } else runs.push(run)
    }
    rows.push(runs)
  }
  return rows
}
