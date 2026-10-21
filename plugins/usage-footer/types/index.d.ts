export type Snapshot = {
  contextTokens: number | null
  contextPercent: number | null
  fiveHourPercent: number | null
  fiveHourResetsAt: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'usage-footer': { snapshot: Snapshot | null; now: number }
  }
}
