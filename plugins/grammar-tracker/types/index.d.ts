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

/** A mistake of the Top mistakes tab, with its occurrences in the last 7 days. */
export interface TopMistake extends Occurrence {
  recent: number
}

/** A mistake type's name and rule. */
export interface TypeInfo {
  type: string
  typeLabel: string
  typeDescription: string
  typeExample: string | null
}

/**
 * Something to focus on: the type with the most rows in the top list, the mistake made most above its usual rate in the
 * last 7 days (`aboveUsual` times more than that rate predicts), or a recurring mistake no prompt of the last 7 days made.
 */
export type Focus =
  | (TypeInfo & { kind: 'type'; rows: number; count: number })
  | (TypeInfo & { kind: 'rising'; identifier: string; recent: number; aboveUsual: number })
  | (TypeInfo & { kind: 'fading'; identifier: string })

/** Counts over every saved prompt. */
export interface TopTotals {
  mistakes: number
  prompts: number
  cleanPrompts: number
  recurring: number
}

export interface TopReport {
  totals: TopTotals
  mistakes: TopMistake[]
  focus: Focus[]
}

/** The Top mistakes tab: null while query.py runs, the report it returned, or the error it failed with. */
export type TopMistakes = TopReport | { error: string } | null

declare module 'claude-code' {
  interface PluginState {
    'grammar-tracker': {
      last: GrammarCheck | null
      isOpen: boolean
      tab: PaneTab
      top: TopMistakes
      // The open rows and Focus next items of the Top mistakes tab, by id in hooks/draw.tsx.
      openRows: string[]
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
