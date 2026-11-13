export interface Occurrence {
  type: string
  typeLabel: string
  typeDescription: string
  typeExample: string | null
  identifier: string
  original: string
  corrected: string
  reason: string | null
  count: number
  isRecurring: boolean
}

export type GrammarCheck =
  { doesNotApply: true } | { doesNotApply: false; correctedPrompt: string; occurrences: Occurrence[] }

export type PaneTab = 'last' | 'top'

/** The Top mistakes tab: null while query.py runs, the mistakes it returned, or the error it failed with. */
export type TopMistakes = { mistakes: Occurrence[] } | { error: string } | null

declare module 'claude-code' {
  interface PluginState {
    'grammar-tracker': {
      last: GrammarCheck | null
      isOpen: boolean
      tab: PaneTab
      top: TopMistakes
      openRow: string | null
      // The mistake count of each of the last prompts of this conversation, oldest first; null until loaded.
      trend: number[] | null
      // True from the start of a turn until its check arrives or the turn ends.
      pending: boolean
      // True once the user hid the pane by hand, until the Show button opens it again. A check opens the pane only while it is false.
      manualHide: boolean
    }
  }
}
