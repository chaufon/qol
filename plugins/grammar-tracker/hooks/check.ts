import type { GrammarCheck, Occurrence } from '../types'

export const CHECK_LABEL = '**English grammar check:**'
const NOT_APPLY = 'English grammar check does not apply'
const BLOCK = /```grammar-json\s*\n[\s\S]*?\n\s*```\s*/
const BLOCK_OPEN = '```grammar-json'
const BLOCK_CLOSED = /^```grammar-json\s*\n[\s\S]*?\n\s*```/

/** One mistake as scripts/save_check.py and scripts/query.py print it. */
export interface OccurrenceFields {
  type: string
  type_label: string
  type_description: string
  type_example: string | null
  identifier: string
  original: string
  corrected: string
  reason: string | null
  count: number
  is_recurring: boolean
}

/**
 * What scripts/prompt_context.py prints: the grammar check instruction for a prompt, absent for a prompt that skips it.
 */
export interface ContextOutput {
  context?: string
  systemMessage?: string
}

/** What scripts/save_check.py prints. */
export interface SaveOutput {
  systemMessage?: string
  does_not_apply?: true
  corrected_prompt?: string
  occurrences?: OccurrenceFields[]
}

function afterLabel(start: string): string {
  return start.startsWith(CHECK_LABEL) ? start.slice(CHECK_LABEL.length).trimStart() : start
}

/**
 * Removes the grammar check label and its grammar-json block from the start of a reply's first block.
 * A grammar-json block that is still streaming hides the whole text until it closes.
 */
export function stripCheck(text: string): string {
  const start = text.trimStart()
  const body = afterLabel(start)
  if (body.startsWith(NOT_APPLY)) {
    const end = body.indexOf('\n\n')
    return end === -1 ? '' : body.slice(end + 2)
  }
  if (body !== start) {
    const block = BLOCK.exec(start)
    if (block) return start.slice(block.index + block[0].length)
    if (start.includes(BLOCK_OPEN)) return ''
  }
  return text
}

/**
 * What the reply streamed so far says about the check: 'check' once its grammar-json block is closed, 'not-apply' once
 * the does-not-apply line is in, 'waiting' while the start of the reply can still become either, and 'unlikely' once
 * the reply cannot be a check.
 */
export type CheckState = 'check' | 'not-apply' | 'waiting' | 'unlikely'

export function checkState(text: string): CheckState {
  const body = afterLabel(text.trimStart())
  if (body.startsWith(NOT_APPLY)) return 'not-apply'
  if (body.startsWith(BLOCK_OPEN)) return BLOCK_CLOSED.test(body) ? 'check' : 'waiting'
  return [CHECK_LABEL, NOT_APPLY, BLOCK_OPEN].some(opener => opener.startsWith(body)) ? 'waiting' : 'unlikely'
}

export function toOccurrence(o: OccurrenceFields): Occurrence {
  return {
    type: o.type,
    typeLabel: o.type_label,
    typeDescription: o.type_description,
    typeExample: o.type_example,
    identifier: o.identifier,
    original: o.original,
    corrected: o.corrected,
    reason: o.reason,
    count: o.count,
    isRecurring: o.is_recurring,
  }
}

export function toCheck(output: SaveOutput): GrammarCheck | null {
  if (output.does_not_apply) return { doesNotApply: true }
  if (output.occurrences === undefined) return null
  return {
    doesNotApply: false,
    correctedPrompt: output.corrected_prompt ?? '',
    occurrences: output.occurrences.map(toOccurrence),
  }
}
