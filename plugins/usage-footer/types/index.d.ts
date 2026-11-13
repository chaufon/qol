export interface Snapshot {
  contextTokens: number | null
  // The size is the count /context shows, not one Claude's servers measured.
  isEstimate: boolean
  contextPercent: number | null
  contextWindow: number | null
  fiveHourPercent: number | null
  fiveHourResetsAt: string | null
  sevenDayPercent: number | null
  sevenDayResetsAt: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'usage-footer': { snapshot: Snapshot | null; now: number }
  }
}
