import type { Window, WindowKind } from '../types'

export const WINDOW_MS: Record<WindowKind, number> = {
  five_hour: 5 * 3_600_000,
  seven_day: 7 * 24 * 3_600_000,
}

// The engine's SessionRateLimit: percentUsed runs 0 to 100.
export type Reading = { kind: string; percentUsed: number; resetsAt?: string }

const KINDS: WindowKind[] = ['five_hour', 'seven_day']

const isKind = (kind: string): kind is WindowKind => (KINDS as string[]).includes(kind)

// The windows to store after one reading: none, the updated live window, or a closed
// window plus a new one. A reading that ends at or before now stores nothing. A reading whose end differs from the live window's is a
// reset when usage fell to 1 % or less, otherwise the same window with a later end.
export function observe(stored: Window[], reading: Reading, now: number): Window[] {
  if (!isKind(reading.kind) || !reading.resetsAt) return []
  const end = Date.parse(reading.resetsAt)
  if (Number.isNaN(end) || end <= now) return []
  const kind = reading.kind
  const percentUsed = reading.percentUsed
  const ofKind = stored.filter((w) => w.kind === kind)

  let live: Window | undefined
  for (const w of ofKind) if (w.end > now && (!live || w.start > live.start)) live = w

  if (!live) {
    const lastEnd = ofKind.reduce((max, w) => Math.max(max, w.end), -Infinity)
    return [{ kind, start: Math.max(end - WINDOW_MS[kind], lastEnd), end, percentUsed }]
  }
  if (live.end === end) return live.percentUsed === percentUsed ? [] : [{ ...live, percentUsed }]
  if (percentUsed <= 1 && percentUsed < live.percentUsed) {
    return [{ ...live, end: now }, { kind, start: now, end, percentUsed }]
  }
  return [{ ...live, end, percentUsed }]
}

// For each kind, the stored window containing now (five-hour first).
export function currentWindows(stored: Window[], now: number): Window[] {
  const out: Window[] = []
  for (const kind of KINDS) {
    const hit = stored.find((w) => w.kind === kind && w.start <= now && now < w.end)
    if (hit) out.push(hit)
  }
  return out
}
