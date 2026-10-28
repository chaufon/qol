export const COLORS = {
  input: '#61afef',
  cacheWrite: '#e5c07b',
  cacheRead: '#98c379',
  output: '#c678dd',
  cost: '#f0c674',
  subagent: '#56b6c2',
  accent: '#d19a66',
  dim: '#7f848e',
}

export const PROJECT_PALETTE = ['#e06c75', '#f78c6c', '#ff6ac1', '#4fd6be', '#c3e88d', '#82aaff', '#b4befe', '#eba0ac']

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const fmtTokens = (n: number): string => {
  if (n < 1_000) return String(n)
  if (n < 999_950) return `${(n / 1_000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export const fmtCost = (c: number | null): string => (c === null ? '?' : `$${c.toFixed(2)}`)

// A price per million tokens: two decimals, or three when the third is not 0 ($0.125).
export const fmtPrice = (p: number): string => `$${p.toFixed(Math.round(p * 1000) % 10 === 0 ? 2 : 3)}`

const pad = (n: number): string => String(n).padStart(2, '0')

export const hhmm = (ms: number): string => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const weekday = (ms: number): string => WEEKDAYS[new Date(ms).getDay()]!

export const dayLabel = (ms: number, now: number): string => {
  const d = new Date(ms)
  const date = `${weekday(ms)} ${d.getDate()} ${MONTHS[d.getMonth()]}`
  const startOf = (t: Date) => new Date(t.getFullYear(), t.getMonth(), t.getDate())
  const days = Math.round((startOf(new Date(now)).getTime() - startOf(d).getTime()) / 86_400_000)
  if (days === 0) return `Today · ${date}`
  if (days === 1) return `Yesterday · ${date}`
  return date
}

export const projectLabel = (path: string): string => {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

// FNV-1a 32-bit hash of the path, modulo the palette length.
export const projectColor = (path: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < path.length; i++) {
    h ^= path.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return PROJECT_PALETTE[h % PROJECT_PALETTE.length]!
}
