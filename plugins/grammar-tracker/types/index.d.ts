export type Occurrence = {
  type: string
  typeLabel: string
  typeDescription: string
  typeExample: string | null
  identifier: string
  original: string
  corrected: string
  count: number
  isRecurring: boolean
}

export type GrammarCheck =
  | { doesNotApply: true }
  | { doesNotApply: false; summary: string; correctedPrompt: string; occurrences: Occurrence[] }

export type PaneTab = 'last' | 'top'

// The Top mistakes tab: null while query.py runs, the mistakes it returned, or the error it failed with.
export type TopMistakes = { mistakes: Occurrence[] } | { error: string } | null

declare module 'claude-code' {
  interface PluginState {
    'grammar-tracker': {
      last: GrammarCheck | null; isOpen: boolean; tab: PaneTab; top: TopMistakes; openRow: string | null
    }
  }
}
