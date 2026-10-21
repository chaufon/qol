import type { Snapshot } from '../types'

// Each emoji exists only in the system's color emoji font (Noto Color Emoji on most Linux desktops),
// so it draws in color, two columns wide, in any terminal. Clocks and hourglasses are left out: text
// fonts such as GNU FreeFont carry small monochrome copies of them, which terminals pick first. None
// needs a variation selector, which terminals measure differently. The separator and the bar are box drawing and block elements, glyphs of every
// monospaced font.
export const ICONS = { context: '📚', reset: '🔔', separator: '┊' } as const

export const BAR_CELLS = 10

const PARTIALS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

// The filled part in eighths of a cell, and the empty cells after it.
export const bar = (percent: number, cells = BAR_CELLS): { filled: string; empty: string } => {
  const eighths = Math.round((Math.min(100, Math.max(0, percent)) / 100) * cells * 8)
  const full = Math.floor(eighths / 8)
  const partial = PARTIALS[eighths % 8] ?? ''
  const used = full + (partial === '' ? 0 : 1)

  return { filled: '█'.repeat(full) + partial, empty: '░'.repeat(cells - used) }
}

export type Tone = 'success' | 'warning' | 'error'

export type Segment = { text: string; tone?: Tone; isBold?: boolean; isDim?: boolean }

export const tokens = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
    : n >= 1000
      ? `${Math.round(n / 1000)}k`
      : `${n}`

const pad = (n: number): string => `${n}`.padStart(2, '0')

export const countdown = (ms: number): string => {
  const minutes = Math.max(0, Math.ceil(ms / 60_000))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60

  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export const contextTone = (n: number): Tone => (n < 100_000 ? 'success' : n <= 150_000 ? 'warning' : 'error')

export const fiveHourTone = (percent: number): Tone => (percent < 70 ? 'success' : percent <= 90 ? 'warning' : 'error')

export const resetTone = (ms: number): Tone => (ms <= 30 * 60_000 ? 'error' : 'success')

export const segments = (s: Snapshot, now: number): Segment[] => {
  const out: Segment[] = [{ text: `${ICONS.context} `, isDim: true }]

  if (s.contextTokens === null) {
    out.push({ text: '–', isDim: true })
  } else {
    out.push({ text: tokens(s.contextTokens), tone: contextTone(s.contextTokens), isBold: true })

    if (s.contextPercent !== null) {
      out.push({ text: ` (${s.contextPercent}%)`, isDim: true })
    }
  }

  if (s.fiveHourPercent === null) {
    return out
  }

  const tone = fiveHourTone(s.fiveHourPercent)
  const { filled, empty } = bar(s.fiveHourPercent)

  out.push(
    { text: ` ${ICONS.separator} `, isDim: true },
    { text: filled, tone },
    { text: empty, isDim: true },
    { text: ` ${Math.round(s.fiveHourPercent)}%`, tone, isBold: true },
  )

  if (s.fiveHourResetsAt !== null) {
    const at = new Date(s.fiveHourResetsAt)
    const left = at.getTime() - now

    out.push(
      { text: ` ${ICONS.reset} `, isDim: true },
      { text: `${pad(at.getHours())}:${pad(at.getMinutes())} (${countdown(left)})`, tone: resetTone(left) },
    )
  }

  return out
}

export const plain = (parts: Segment[]): string => parts.map(p => p.text).join('')
