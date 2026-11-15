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

/**
 * A check of one prompt. `streak` is the number of prompts in a row with no mistakes that ends at this one, across every
 * conversation, and `bestBefore` the longest streak before it; both are absent from a check kept by an older version.
 */
export type GrammarCheck =
  | { doesNotApply: true }
  | {
      doesNotApply: false
      correctedPrompt: string
      occurrences: Occurrence[]
      streak?: number
      bestBefore?: number
    }

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
      // Whether the cards show their type's rule, set by the footer key; null follows the showTypeRules option.
      rulesShown: boolean | null
      // The cards of the last check whose own button turned their rule the other way, by cardId in hooks/draw.tsx.
      flippedRules: string[]
      // True from the start of a turn until its check arrives or the turn ends.
      pending: boolean
      // True once the user hid the pane by hand, until the Show button opens it again. A check opens the pane only while it is false.
      manualHide: boolean
    }
  }
}
