import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { shareCells, bandChips, barFill, cell, checkState, cleanStreak, countColumn, meter, mascotRows, mistakeColumn, sparkline,
         stripCheck, toCheck, typeColor, typeIcon } from './register'


const SAVE_OUTPUT = {
  corrected_prompt: 'What files does the mod folder have?',
  occurrences: [
    { type: 'article', type_label: 'article', identifier: 'the', original: 'a', corrected: 'b',
      reason: 'a known remote takes the', count: 1,
      is_recurring: false, type_description: 'A wrong, missing or extra "a/an" or "the".',
      type_example: '"the people are selfish" instead of "people are selfish"' },
    { type: 'malformed_tense', type_label: 'malformed tense', identifier: 'does have', original: 'c',
      corrected: 'd', reason: null, count: 3, is_recurring: true,
      type_description: 'The right tense built wrong: auxiliaries missing, extra or in the wrong place.',
      type_example: null },
  ],
}


const TURN = { answer: 'reply', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const
const BAND = {
  plugin: 'grammar-tracker', component: 'AbovePrompt', requestId: 'band',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 },
           view: {} },
} as const
const PANE_PROPS = {
  title: 'Grammar', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 10 }, view: {},
} as const

const CHECK_TEXT = '**English grammar check:**\n```grammar-json\n{"mistakes": []}\n```\n\nThe answer.'
const CHECK_BLOCK_END = '**English grammar check:**\n```grammar-json\n{"mistakes": []}\n```'

function engine(on: On, stdout: string) {
  const calls = { stdout, stderr: '', exitCode: 0, top: JSON.stringify(SAVE_OUTPUT.occurrences), trend: '[1,0,2,0,0]', isTrendBroken: false, isTopBroken: false, runs: [] as (readonly string[])[], opened: [] as string[],
                  focus: [] as (boolean | undefined)[], closed: [] as string[], toasts: [] as string[], inputs: [] as string[],
                  chunks: [] as string[], gate: undefined as Promise<void> | undefined, yielded: [] as string[],
                  inits: [] as unknown[], pythons: { python3: '3' } as Record<string, string>,
                  probes: [] as string[] }
  on('process.run', ($, e) => {
    if (e.argv.includes('-c')) {
      calls.probes.push(e.argv[0]!)
      const major = calls.pythons[e.argv[0]!]
      if (major === undefined) throw new Error(`${e.argv[0]}: not found`)
      return { value: { exitCode: 0, stdout: `${major}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    calls.runs.push(e.argv)
    calls.inits.push(e.init)
    if (e.argv[2] === 'top' && calls.isTopBroken) throw new Error('timed out')
    if (e.argv[2] === 'trend' && calls.isTrendBroken) throw new Error('timed out')
    if (e.argv[2] === 'trend') {
      return { value: { exitCode: 0, stdout: calls.trend, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (e.argv[2] === 'top') {
      return { value: { exitCode: 0, stdout: calls.top, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    calls.inputs.push(String((e.init as { stdin?: string } | undefined)?.stdin))
    return { value: { exitCode: calls.exitCode, stdout: calls.stdout, stderr: calls.stderr, isStdoutTruncated: false,
                      isStderrTruncated: false } }
  })
  on('ui.open', ($, e) => { calls.opened.push(e.id); calls.focus.push(e.focus); return { value: { isPlaced: true } } })
  on('ui.close', ($, e) => { calls.closed.push(e.id); return { value: undefined } })
  on('ui.panes', () => {
    const up = calls.opened.length > calls.closed.length
    return { value: up ? [{ id: 'grammar', title: '✎ Grammar', isShown: true, isFocused: false, isPlaced: true }] : [] }
  })
  on('ui.toast', ($, e) => { calls.toasts.push(e.text); return { value: undefined } })
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('clock.now', () => ({ value: Date.parse('2026-10-17T12:00:00.000Z') }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* ($, e) {
    for (const text of calls.chunks) {
      calls.yielded.push(text)
      yield { kind: 'text', index: 0, text }
      if (calls.gate && text === calls.chunks.at(-2)) await calls.gate
    }
    return { turnId: e.turnId, index: e.index, answer: calls.chunks.join(''), toolUses: [], stopReason: 'end_turn',
             usage: null } as never
  })
  on('turn.complete', () => ({ text: 'reply' }))
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'beneath' }))
  return calls
}

type Calls = ReturnType<typeof engine>

// The model streams the reply in these chunks: the prompt is submitted, the turn starts, its step streams.
async function stream($: Engine, calls: Calls, chunks: string[], turnId = 't1', agentId?: string) {
  calls.chunks = chunks
  calls.yielded = []
  const step = $.turn.step({ turnId, index: 0, model: 'm', messageCount: 1, ...(agentId ? { agentId } : {}) })
  const seen: string[] = []
  for await (const chunk of step) if (chunk.kind === 'text') seen.push(chunk.text)
  return seen
}

async function startTurn($: Engine, text = 'the people', turnId = 't1') {
  await $.prompt.submit({ text } as never)
  await $.turn.start({ text, turnId })
}

// One whole turn: submitted, streamed and complete.
async function turn($: Engine, calls: Calls, chunks: string[], turnId = 't1') {
  await startTurn($, 'the people', turnId)
  await stream($, calls, chunks, turnId)
  await $.turn.complete({ ...TURN, turnId })
}

declare const setTimeout: (callback: (value?: unknown) => void, ms: number) => unknown

async function until(done: () => Promise<boolean> | boolean) {
  for (let n = 0; n < 200 && !(await done()); n++) await new Promise(resolve => setTimeout(resolve, 0))
}

async function bandHas($: Engine, text: string | RegExp, surface: 'terminal' | 'desktop' = 'terminal') {
  const band = await $.ui.mount({ ...BAND, requestId: 'probe', surface })
  const found = (await band.find({ text })) !== undefined
  await band.unmount()
  return found
}

// Draws the band and presses its Show button, as a click or ctrl+x tab then g does.
async function pressBand($: Engine) {
  await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.ui.press({ plugin: 'grammar-tracker', key: 'toggle' })
}

test('stripCheck removes the check and its grammar-json block', () => {
  const text = '**English grammar check:**\n```grammar-json\n{"mistakes": []}\n```\n\nThe answer.'
  expect(stripCheck(text)).toBe('The answer.')
})

test('stripCheck removes the "does not apply" paragraph', () => {
  expect(stripCheck('English grammar check does not apply.\n\nThe answer.')).toBe('The answer.')
  expect(stripCheck('**English grammar check:** English grammar check does not apply.\n\nThe answer.')).toBe('The answer.')
})

test('stripCheck ignores whitespace before the check', () => {
  const text = '\n **English grammar check:**\n```grammar-json\n{"mistakes": []}\n```\n\nThe answer.'
  expect(stripCheck(text)).toBe('The answer.')
  expect(stripCheck('\nEnglish grammar check does not apply.\n\nThe answer.')).toBe('The answer.')
})

test('stripCheck hides a grammar-json block that is still streaming', () => {
  expect(stripCheck('**English grammar check:**\n```grammar-json\n{"mistakes": [')).toBe('')
})

test('stripCheck leaves other text unchanged', () => {
  expect(stripCheck('The answer.')).toBe('The answer.')
  expect(stripCheck('**English grammar check:** no block')).toBe('**English grammar check:** no block')
})

test('toCheck and bandChips summarize the output of save_check.py', () => {
  expect(bandChips(toCheck(SAVE_OUTPUT)!)).toEqual([{ text: '✗ 2 mistakes', color: 'error' },
                                                    { text: '⟳ 1 recurring', color: 'warning' }])
  expect(bandChips(toCheck({ ...SAVE_OUTPUT, occurrences: [SAVE_OUTPUT.occurrences[0]!] })!))
    .toEqual([{ text: '✗ 1 mistake', color: 'error' }])
  expect(bandChips(toCheck({ does_not_apply: true })!)).toEqual([{ text: 'Grammar check does not apply to the last prompt', isDim: true }])
  expect(bandChips(toCheck({ ...SAVE_OUTPUT, occurrences: [] })!)).toEqual([{ text: '✓ No mistakes', color: 'success' }])
  expect(toCheck({ systemMessage: 'Grammar tracker: failed to log (see errors.log)' })).toBe(null)
})

test('the reply drawn has no check in its first block only', async ($, on) => {
  const seen: string[] = []
  on('ui.render', ($, e) => {
    if (e.component === 'AssistantMessage') seen.push(e.props.text)
    return $.ui.resolve(e).Text({ children: '' })
  })
  const check = '**English grammar check:**\n```grammar-json\n{}\n```\n\nThe answer.'
  for (const isFirstOfReply of [true, false]) {
    await $.ui.render({ surface: 'terminal', component: 'AssistantMessage', requestId: 'm1',
                        props: { text: check, isFirstOfReply } })
  }
  expect(seen).toEqual(['The answer.', check])
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a closed check block is saved at once, then the band shows it and the pane opens (${surface})`, async ($, on) => {
    const calls = engine(on, JSON.stringify(SAVE_OUTPUT))
    await turn($, calls, [CHECK_TEXT])
    expect(calls.runs[0]?.[1]?.endsWith('/grammar-tracker/scripts/save_check.py')).toBe(true)
    expect(JSON.parse(calls.inputs[0]!)).toEqual({ turn_id: 't1', session_id: 's1', cwd: '/proj', prompt: 'the people',
                                                   reply: CHECK_TEXT, timestamp: '2026-10-17T12:00:00.000Z' })
    expect(await bandHas($, '✗ 2 mistakes', surface)).toBe(true)
    expect(calls.opened).toEqual(['grammar'])
    expect(await bandHas($, 'Hide', surface)).toBe(true)
  })
}

test('the check is saved and shown while the rest of the reply still streams', async ($, on) => {
  const calls = engine(on, JSON.stringify(SAVE_OUTPUT))
  let release = () => {}
  calls.gate = new Promise(resolve => { release = resolve })
  await startTurn($)
  const done = stream($, calls, ['**English grammar check:**\n```grammar-', 'json\n{"mistakes": []}\n```', '\n\nThe answer'])
  await until(async () => await bandHas($, '✗ 2 mistakes'))
  expect(await bandHas($, '✗ 2 mistakes')).toBe(true)
  expect(calls.opened).toEqual(['grammar'])
  expect(calls.focus).toEqual([undefined])
  release()
  await done
  await $.turn.complete(TURN)
  expect(await bandHas($, '✗ 2 mistakes')).toBe(true)
  expect(calls.runs.filter(argv => argv[1]?.endsWith('save_check.py'))).toHaveLength(1)
})

test('the chunks of the reply pass on unchanged', async ($, on) => {
  const calls = engine(on, JSON.stringify(SAVE_OUTPUT))
  await startTurn($)
  const chunks = ['**English grammar check:**\n```grammar-json\n{"mis', 'takes": []}\n```\n\n', 'The answer.']
  expect(await stream($, calls, chunks)).toEqual(chunks)
})

test('the band says checking and the pane hides the check before while the reply streams', async ($, on) => {
  const calls = engine(on, JSON.stringify(SAVE_OUTPUT))
  await turn($, calls, [CHECK_TEXT])
  await startTurn($, 'next prompt', 't2')
  expect(await bandHas($, '⠋ Checking…')).toBe(true)
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ text: '⠋ Checking this prompt…' })).toBeDefined()
  expect(await pane.find({ text: '✗ c' })).toBeUndefined()
  expect(await pane.find({ text: ' ✎ Corrected prompt ' })).toBeUndefined()
})

test('the pane shows only the checking line while the first prompt is checked', async ($, on) => {
  engine(on, '')
  await startTurn($)
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ text: '⠋ Checking this prompt…' })).toBeDefined()
  expect(await pane.find({ text: /No grammar check/ })).toBeUndefined()
})

test('a check that arrives keeps the tab of a pane already open and refreshes it', async ($, on) => {
  const calls = engine(on, JSON.stringify(SAVE_OUTPUT))
  await pressBand($)
  const pane = await $.ui.mount(PANE)
  await $.ui.press({ plugin: 'grammar-tracker', key: 'tab-top' })
  await turn($, calls, [CHECK_TEXT])
  expect(calls.opened).toEqual(['grammar'])
  expect(await pane.find({ text: /Malformed tense/ })).toBeDefined()
  await $.ui.press({ plugin: 'grammar-tracker', key: 'tab-next' })
  await pane.redraw()
  expect(await pane.find({ text: ' ª Article · "the" ' })).toBeDefined()
})

test('a check opens the pane on the Last prompt tab, without focus', async ($, on) => {
  const calls = engine(on, JSON.stringify(SAVE_OUTPUT))
  await turn($, calls, [CHECK_TEXT])
  expect(calls.focus).toEqual([undefined])
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ text: ' ª Article · "the" ' })).toBeDefined()
})

test('a pane the user hid is not opened by a check until the Show button opens it again', async ($, on) => {
  const calls = engine(on, JSON.stringify(SAVE_OUTPUT))
  await turn($, calls, [CHECK_TEXT])
  await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.ui.press({ plugin: 'grammar-tracker', key: 'toggle' })
  expect(calls.closed).toEqual(['grammar'])
  await turn($, calls, [CHECK_TEXT], 't2')
  expect(calls.opened).toEqual(['grammar'])
  expect(await bandHas($, '✗ 2 mistakes')).toBe(true)
  await $.ui.press({ plugin: 'grammar-tracker', key: 'toggle' })
  expect(calls.opened).toEqual(['grammar', 'grammar'])
  expect(calls.focus).toEqual([undefined, true])
  await $.ui.press({ plugin: 'grammar-tracker', key: 'toggle' })
  await turn($, calls, [CHECK_TEXT], 't3')
  expect(calls.opened).toEqual(['grammar', 'grammar'])
})

test('the does-not-apply line shows in the band as it streams and does not open the pane', async ($, on) => {
  const calls = engine(on, '')
  await startTurn($)
  await stream($, calls, ['English grammar check does not apply.', '\n\nDone.'])
  expect(await bandHas($, 'Grammar check does not apply to the last prompt')).toBe(true)
  await $.turn.complete(TURN)
  expect(await bandHas($, 'Grammar check does not apply to the last prompt')).toBe(true)
  expect(calls.opened).toEqual([])
  expect(calls.runs).toEqual([])
})

test('a labeled does-not-apply line shows in the band', async ($, on) => {
  const calls = engine(on, '')
  await turn($, calls, ['**English grammar check:** ', 'English grammar check does not apply.\n\nDone.'])
  expect(await bandHas($, 'Grammar check does not apply to the last prompt')).toBe(true)
})

test('a failed save shows a toast and a band with no check', async ($, on) => {
  const calls = engine(on, JSON.stringify({ systemMessage: 'Grammar tracker: failed to log (see errors.log)' }))
  await turn($, calls, [CHECK_TEXT])
  expect(await bandHas($, 'Grammar: no check for the last prompt')).toBe(true)
  expect(calls.toasts).toEqual(['Grammar tracker: failed to log (see errors.log)'])
  expect(calls.opened).toEqual([])
})

test('a script that exits with an error shows its message in a toast and clears the check', async ($, on) => {
  const calls = engine(on, JSON.stringify(SAVE_OUTPUT))
  await turn($, calls, [CHECK_TEXT])
  calls.stdout = ''
  calls.exitCode = 1
  calls.stderr = 'Grammar tracker needs Python 3.10 or newer, found 3.9.6\n'
  await turn($, calls, [CHECK_TEXT], 't2')
  expect(await bandHas($, 'Grammar: no check for the last prompt')).toBe(true)
  expect(calls.toasts).toEqual(
    ['Grammar tracker: failed to read the check (Error: Grammar tracker needs Python 3.10 or newer, found 3.9.6)'])
})

test('a turn without a check clears the check of the turn before', async ($, on) => {
  const calls = engine(on, JSON.stringify(SAVE_OUTPUT))
  await turn($, calls, [CHECK_TEXT])
  await turn($, calls, ['Done.'], 't2')
  expect(await bandHas($, /mistakes/)).toBe(false)
  expect(await bandHas($, 'Grammar: no check for the last prompt')).toBe(true)
})

test('an interrupted reply clears the check and does not open the pane', async ($, on) => {
  const calls = engine(on, JSON.stringify(SAVE_OUTPUT))
  await startTurn($)
  await stream($, calls, ['**English grammar check:**\n```grammar-json\n{"mist'])
  expect(await bandHas($, '⠋ Checking…')).toBe(true)
  await $.turn.complete({ ...TURN, reason: 'interrupted', isAborted: true } as never)
  expect(await bandHas($, 'Grammar: no check for the last prompt')).toBe(true)
  expect(calls.opened).toEqual([])
  expect(calls.runs).toEqual([])
})

test('a check block that is not at the start of the reply is not saved', async ($, on) => {
  const calls = engine(on, JSON.stringify(SAVE_OUTPUT))
  await turn($, calls, ['The block looks like this:\n```grammar-json\n{"mistakes": []}\n```\n'])
  expect(calls.runs).toEqual([])
  expect(await bandHas($, 'Grammar: no check for the last prompt')).toBe(true)
})

test('checkState follows the start of the reply', () => {
  expect(checkState('')).toBe('waiting')
  expect(checkState('**English gram')).toBe('waiting')
  expect(checkState('**English grammar check:**\n```grammar-js')).toBe('waiting')
  expect(checkState('**English grammar check:**\n```grammar-json\n{"mistakes": [')).toBe('waiting')
  expect(checkState('**English grammar check:**\n```grammar-json\n{"mistakes": []}\n```')).toBe('check')
  expect(checkState('```grammar-json\n{}\n```\nMore')).toBe('check')
  expect(checkState('\nEnglish grammar check does not apply.')).toBe('not-apply')
  expect(checkState('**English grammar check:** English grammar check does not apply')).toBe('not-apply')
  expect(checkState('Here is the answer')).toBe('unlikely')
})

test('the scripts run without a data folder from the mod', async ($, on) => {
  const calls = engine(on, JSON.stringify(SAVE_OUTPUT))
  await turn($, calls, [CHECK_TEXT])
  expect(calls.runs.map(argv => argv[2])).toEqual([undefined, 'trend', 'top', 'top'])
  expect(calls.inits.every(init => (init as { env?: unknown } | undefined)?.env === undefined)).toBe(true)
})

test('skips subagent turns', async ($, on) => {
  const calls = engine(on, JSON.stringify(SAVE_OUTPUT))
  await $.turn.start({ text: 'sub task', turnId: 'a-t', agentId: 'a1' })
  await stream($, calls, [CHECK_TEXT], 'a-t', 'a1')
  await $.turn.complete({ ...TURN, turnId: 'a-t', agentId: 'a1' })
  expect(calls.runs).toEqual([])
  expect(await bandHas($, 'Grammar: no check for the last prompt')).toBe(true)
})

test('a turn that starts without a submitted prompt is not tracked', async ($, on) => {
  const calls = engine(on, JSON.stringify(SAVE_OUTPUT))
  await $.turn.start({ text: 'notification', turnId: 't1' })
  await stream($, calls, [CHECK_TEXT])
  expect(calls.runs).toEqual([])
  expect(await bandHas($, '⠋ Checking…')).toBe(false)
})


test('before any check the band offers the pane, and its button opens and closes it', async ($, on) => {
  const calls = engine(on, '')
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ text: 'Grammar: no check for the last prompt' })).toBeDefined()
  await $.ui.press({ plugin: 'grammar-tracker', key: 'toggle' })
  await $.ui.press({ plugin: 'grammar-tracker', key: 'toggle' })
  expect(calls.opened).toEqual(['grammar'])
  expect(calls.closed).toEqual(['grammar'])
})

test('a failed query.py shows its error in the pane and a toast', async ($, on) => {
  const calls = engine(on, '')
  calls.isTopBroken = true
  await pressBand($)
  expect(calls.opened).toEqual(['grammar'])
  expect(calls.toasts.map(t => t.startsWith('Grammar tracker: failed to read the top mistakes ('))).toEqual([true])
  const pane = await $.ui.mount({ plugin: 'grammar-tracker', surface: 'terminal', component: 'Pane', requestId: 'grammar',
                                  props: PANE_PROPS })
  await $.ui.press({ plugin: 'grammar-tracker', key: 'tab-top' })
  expect(await pane.find({ text: /failed to read the top mistakes/ })).toBeDefined()
})

const PANE = { plugin: 'grammar-tracker', surface: 'terminal', component: 'Pane', requestId: 'grammar',
               props: PANE_PROPS } as const

test('the Last prompt tab draws a card per mistake with its title, sentences, reason and rule', async ($, on) => {
  const calls = engine(on, JSON.stringify(SAVE_OUTPUT))
  await turn($, calls, [CHECK_TEXT])
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ text: ' ª Article · "the" ' })).toBeDefined()
  expect(await pane.find({ text: ' ●○○○○ ×1 ' })).toBeDefined()
  expect(await pane.find({ text: ' ◴ Malformed tense · "does have" ' })).toBeDefined()
  expect(await pane.find({ text: ' ●●●○○ ×3 ⟳ ' })).toBeDefined()
  expect(await pane.find({ text: '✗ c' })).toBeDefined()
  expect(await pane.find({ text: '✓ d' })).toBeDefined()
  expect(await pane.find({ text: 'a known remote takes the' })).toBeDefined()
  expect(await pane.find({ text: 'A wrong, missing or extra "a/an" or "the". ("the people are selfish" instead of "people are selfish")' })).toBeDefined()
  expect(await pane.find({ text: 'The right tense built wrong: auxiliaries missing, extra or in the wrong place.' })).toBeDefined()
  expect(await pane.find({ text: ' ✎ Corrected prompt ' })).toBeDefined()
})

test('the Last prompt tab leaves out the parentheses for an empty example', async ($, on) => {
  const [first] = SAVE_OUTPUT.occurrences
  const calls = engine(on, JSON.stringify({ ...SAVE_OUTPUT, occurrences: [{ ...first, type_example: '' }] }))
  await turn($, calls, [CHECK_TEXT])
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ text: 'A wrong, missing or extra "a/an" or "the".' })).toBeDefined()
})

test('the Last prompt tab praises a check with no mistakes and shows the corrected prompt', async ($, on) => {
  const calls = engine(on, JSON.stringify({ ...SAVE_OUTPUT, occurrences: [] }))
  await turn($, calls, [CHECK_TEXT])
  const pane = await $.ui.mount(PANE)
  const praise = (await pane.findAll({ type: 'Text' })).find(t => t.text === '✓ No mistakes. Great English, keep it up!')
  expect(praise?.props.color).toBe('success')
  expect(praise?.props.bold).toBe(true)
  expect(praise?.props.dimColor).toBeFalsy()
  expect(await pane.find({ text: ' ✎ Corrected prompt ' })).toBeDefined()
})

test('a check with no mistakes shows in the band and does not open the pane', async ($, on) => {
  const calls = engine(on, JSON.stringify({ ...SAVE_OUTPUT, occurrences: [] }))
  await turn($, calls, [CHECK_TEXT])
  expect(await bandHas($, '✓ No mistakes')).toBe(true)
  expect(calls.opened).toEqual([])
})

test('a check with no mistakes leaves an open pane open', async ($, on) => {
  const calls = engine(on, JSON.stringify(SAVE_OUTPUT))
  await turn($, calls, [CHECK_TEXT])
  calls.stdout = JSON.stringify({ ...SAVE_OUTPUT, occurrences: [] })
  await turn($, calls, [CHECK_TEXT], 't2')
  expect(calls.closed).toEqual([])
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ text: '✓ No mistakes. Great English, keep it up!' })).toBeDefined()
})

test('a Top mistakes row opens and closes its example card', async ($, on) => {
  const calls = engine(on, '')
  await pressBand($)
  const pane = await $.ui.mount(PANE)
  await $.ui.press({ plugin: 'grammar-tracker', key: 'tab-top' })
  expect(await pane.find({ text: /Malformed tense/ })).toBeDefined()
  expect(await pane.find({ text: '✗ c' })).toBeUndefined()
  await $.ui.press({ plugin: 'grammar-tracker', key: 'row-1' })
  expect(await pane.find({ text: '✗ c' })).toBeDefined()
  expect(await pane.find({ text: '✓ d' })).toBeDefined()
  expect(await pane.find({ text: '✗ a' })).toBeUndefined()
  await $.ui.press({ plugin: 'grammar-tracker', key: 'row-1' })
  expect(await pane.find({ text: '✗ c' })).toBeUndefined()
})

test('after a /clear the band offers to hide the pane still up, and its Top mistakes tab loads', async ($, on) => {
  const calls = engine(on, '')
  calls.opened.push('grammar')
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ text: 'Hide' })).toBeDefined()
  const pane = await $.ui.mount(PANE)
  await $.ui.press({ plugin: 'grammar-tracker', key: 'tab-top' })
  expect(await pane.find({ text: /Malformed tense/ })).toBeDefined()
})

test('the Top mistakes tab says when nothing is logged', async ($, on) => {
  const calls = engine(on, '')
  calls.top = '[]'
  await pressBand($)
  const pane = await $.ui.mount(PANE)
  await $.ui.press({ plugin: 'grammar-tracker', key: 'tab-top' })
  expect(await pane.find({ text: 'No mistakes logged yet' })).toBeDefined()
})

test('cell cuts or pads a table cell and the Count column fits the largest count', () => {
  expect(cell('article', 4)).toBe('art…')
  expect(cell('the', 5)).toBe('the  ')
  expect(countColumn(7)).toBe(1)
  expect(countColumn(123456)).toBe(6)
})

test('the scripts run with py -3 where python3 does not start, as on Windows', async ($, on) => {
  const calls = engine(on, JSON.stringify(SAVE_OUTPUT))
  calls.pythons = { python3: '', py: '3' }
  await turn($, calls, [CHECK_TEXT])
  expect(calls.probes).toEqual(['python3', 'py'])
  expect(calls.runs[0]?.slice(0, 2)).toEqual(['py', '-3'])
  expect(calls.runs[0]?.[2]?.endsWith('/grammar-tracker/scripts/save_check.py')).toBe(true)
})

test('without Python 3 the check says so in a toast, and a Python installed later is found', async ($, on) => {
  const calls = engine(on, JSON.stringify(SAVE_OUTPUT))
  calls.pythons = { python: '2' }
  await turn($, calls, [CHECK_TEXT])
  expect(calls.probes).toEqual(['python3', 'py', 'python'])
  expect(calls.runs).toEqual([])
  expect(calls.toasts[0]).toContain('Grammar tracker needs Python 3.10 or newer as python3, py or python on the PATH')
  calls.pythons = { python: '3' }
  await turn($, calls, [CHECK_TEXT], 't2')
  expect(calls.runs[0]?.[0]).toBe('python')
})

test('a Top mistakes row with the largest count fits the pane', () => {
  for (const largest of [7, 68, 512, 123456]) {
    const mistake = cell('the', mistakeColumn(80, largest))
    const row = `▾${'10'.padStart(3)} ª ${cell('Article', 15)}  ${mistake} ${'█'.repeat(10)} ${String(largest).padStart(countColumn(largest))}`
    expect(row.length).toBe(80)
  }
})

test('the Top mistakes tab shows a worried mascot, the tiles and the share of each type', async ($, on) => {
  const calls = engine(on, '')
  await pressBand($)
  const pane = await $.ui.mount(PANE)
  await $.ui.press({ plugin: 'grammar-tracker', key: 'tab-top' })
  expect(await pane.find({ text: '1 mistake you keep repeating.' })).toBeDefined()
  expect(await pane.find({ text: /^Watch out for ".*" \(×3\)$/ })).toBeDefined()
  const texts = (await pane.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts).toEqual(expect.arrayContaining(['4', 'Mistakes', 'Recurring', 'Types', 'Where your mistakes go (top 2)', '◴ 75%', '  ª 25%']))
  const counts = (await pane.findAll({ type: 'Text' })).filter(t => /^ \d+$/.test(t.text))
  expect(counts.map(t => [t.text.trim(), t.props.color])).toEqual([['1', 'success'], ['3', 'warning']])
})

test('the footer keys sit on the last row the pane shows, under a line', async ($, on) => {
  const calls = engine(on, JSON.stringify(SAVE_OUTPUT))
  await turn($, calls, [CHECK_TEXT])
  const pane = await $.ui.mount(PANE)
  const footer = (await pane.findAll({ type: 'Box' })).find(b => b.props.position === 'absolute' && b.text.includes('Hide'))
  expect(footer?.props.top).toBe(PANE_PROPS.scroll.bodyRows - 2)
  expect(footer?.text.startsWith('─'.repeat(PANE_PROPS.bodyColumns))).toBe(true)
})

test('the footer key t switches between the tabs, and the tab on show is colored', async ($, on) => {
  const calls = engine(on, JSON.stringify(SAVE_OUTPUT))
  await turn($, calls, [CHECK_TEXT])
  const pane = await $.ui.mount(PANE)
  const keys = (await pane.findAll({ type: 'Button' })).filter(b => b.props.hotkey !== undefined).map(b => b.props.hotkey)
  expect(keys).toEqual(['t', 'h'])
  await $.ui.press({ plugin: 'grammar-tracker', key: 'tab-next' })
  await pane.redraw()
  const shown = async () => (await pane.findAll({ type: 'Text' })).find(t => t.props.backgroundColor === 'planMode')?.text
  expect(await shown()).toBe(' Top mistakes ')
  await $.ui.press({ plugin: 'grammar-tracker', key: 'tab-next' })
  await pane.redraw()
  expect(await shown()).toBe(' Last prompt ')
})

test('the Top mistakes rows draw an icon and a bar as long as the count', async ($, on) => {
  const calls = engine(on, '')
  await pressBand($)
  const pane = await $.ui.mount(PANE)
  await $.ui.press({ plugin: 'grammar-tracker', key: 'tab-top' })
  const texts = (await pane.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts).toContain('ª')
  expect(texts).toContain('◴')
  expect(texts).toContain('█'.repeat(10))
  expect(texts).toContain('█'.repeat(3))
  expect(texts).toContain('░'.repeat(7))
})

test('the Last prompt tab shows the tiles, the trend of this conversation and a worried mascot for a recurring mistake', async ($, on) => {
  const calls = engine(on, JSON.stringify(SAVE_OUTPUT))
  await turn($, calls, [CHECK_TEXT])
  const pane = await $.ui.mount(PANE)
  expect(calls.runs.some(run => run[2] === 'trend' && run[3] === 's1' && run[4] === '10')).toBe(true)
  expect(await pane.find({ text: '2 mistakes, 1 you keep repeating.' })).toBeDefined()
  expect(await pane.find({ text: 'Watch out for "does have" (×3)' })).toBeDefined()
  const tiles = (await pane.findAll({ type: 'Box' })).filter(b => b.props.borderStyle === 'round' && b.props.alignItems === 'center')
  expect(tiles.map(t => t.text.replace(/\s+/g, ' ').trim())).toEqual(['2Mistakes', '1Recurring', '2Clean streak'])
  const bars = (await pane.findAll({ type: 'Text' })).filter(t => '▁▂▃▄▅▆▇█'.includes(t.text) && t.text.length === 1 && (t.props.color === 'warning' || t.props.color === 'success'))
  expect(bars.map(t => [t.text, t.props.color])).toEqual([['▅', 'warning'], ['▁', 'success'], ['█', 'warning'], ['▁', 'success'], ['▁', 'success']])
  expect(await pane.find({ text: ' last 5 prompts' })).toBeDefined()
})

test('a check with no mistakes shows the clean streak and a happy mascot', async ($, on) => {
  const calls = engine(on, JSON.stringify({ ...SAVE_OUTPUT, occurrences: [] }))
  await turn($, calls, [CHECK_TEXT])
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ text: '2 prompts in a row with no mistakes' })).toBeDefined()
})

test('a failed trend query shows a toast and a dash for the streak', async ($, on) => {
  const calls = engine(on, JSON.stringify(SAVE_OUTPUT))
  calls.isTrendBroken = true
  await turn($, calls, [CHECK_TEXT])
  expect(calls.toasts.some(t => t.startsWith('Grammar tracker: failed to read the trend ('))).toBe(true)
  const pane = await $.ui.mount(PANE)
  const tiles = (await pane.findAll({ type: 'Box' })).filter(b => b.props.borderStyle === 'round' && b.props.alignItems === 'center')
  expect(tiles.map(t => t.text.replace(/\s+/g, ' ').trim()).at(-1)).toBe('–Clean streak')
})

test('meter, barFill, sparkline and cleanStreak scale a count', () => {
  expect([1, 2, 3, 4, 5, 9, 10, 59].map(meter)).toEqual(['●○○○○', '●●○○○', '●●●○○', '●●●○○', '●●●●○', '●●●●○', '●●●●●', '●●●●●'])
  expect([barFill(59, 59), barFill(1, 59), barFill(30, 59)]).toEqual([10, 1, 5])
  expect(sparkline([0, 1, 4, 8])).toEqual(['▁', '▂', '▅', '█'])
  expect(sparkline([0, 0])).toEqual(['▁', '▁'])
  expect([cleanStreak([1, 0, 0]), cleanStreak([0, 2]), cleanStreak([]), cleanStreak([0, 0])]).toEqual([2, 0, 0, 2])
})

test('every mistake type has an icon and a color, and an unknown type uses the "other" ones', () => {
  expect(typeIcon('article')).toBe('ª')
  expect(typeIcon('nope')).toBe(typeIcon('other'))
  expect(typeColor('nope')).toBe(typeColor('other'))
})

test('the mascot is four rows of ten cells, and its mouth turns down when worried', () => {
  const text = (rows: ReturnType<typeof mascotRows>) => rows.map(row => row.map(run => run.text).join(''))
  const happy = mascotRows('happy')
  expect(happy.length).toBe(4)
  expect(text(happy).map(row => row.length)).toEqual([10, 10, 10, 10])
  expect(text(mascotRows('worried'))).not.toEqual(text(happy))
})

test('shareCells splits a bar by share, one cell at least, and fills the bar', () => {
  expect(shareCells([3, 1], 8)).toEqual([6, 2])
  expect(shareCells([59, 31, 22, 17, 12, 9, 6, 4], 68).reduce((a, b) => a + b, 0)).toBe(68)
  expect(shareCells([100, 1, 1], 10)).toEqual([8, 1, 1])
  expect(shareCells([1, 1, 1], 2)).toEqual([1, 1])
  expect(shareCells([], 10)).toEqual([])
})
