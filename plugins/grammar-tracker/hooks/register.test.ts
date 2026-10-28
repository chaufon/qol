import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { bandLine, bar, cell, mistakeColumn, stripCheck, toCheck } from './register'


const STOP_OUTPUT = {
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

function engine(on: On, stdout: string) {
  const calls = { stdout, stderr: '', exitCode: 0, top: JSON.stringify(STOP_OUTPUT.occurrences), isTopBroken: false, runs: [] as (readonly string[])[], opened: [] as string[],
                  closed: [] as string[], toasts: [] as string[],
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
    if (e.argv[2] === 'top') {
      return { value: { exitCode: 0, stdout: calls.top, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    return { value: { exitCode: calls.exitCode, stdout: calls.stdout, stderr: calls.stderr, isStdoutTruncated: false,
                      isStderrTruncated: false } }
  })
  on('ui.open', ($, e) => { calls.opened.push(e.id); return { value: { isPlaced: true } } })
  on('ui.close', ($, e) => { calls.closed.push(e.id); return { value: undefined } })
  on('ui.toast', ($, e) => { calls.toasts.push(e.text); return { value: undefined } })
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('turn.complete', () => ({ text: 'reply' }))
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'beneath' }))
  return calls
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

test('toCheck and bandLine summarize the stop hook output', () => {
  expect(bandLine(toCheck(STOP_OUTPUT)!)).toBe('Grammar: 2 mistakes, 1 recurring')
  expect(bandLine(toCheck({ does_not_apply: true })!)).toBe('Grammar check does not apply to the last prompt')
  expect(bandLine(toCheck({ ...STOP_OUTPUT, occurrences: [] })!)).toBe('Grammar: no mistakes')
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
  test(`the band shows the last check and its button opens the pane (${surface})`, async ($, on) => {
    const calls = engine(on, JSON.stringify(STOP_OUTPUT))
    await $.turn.complete(TURN)
    expect(calls.runs[0]?.[1]?.endsWith('/grammar-tracker/scripts/stop_hook.py')).toBe(true)
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ text: 'Grammar: 2 mistakes, 1 recurring' })).toBeDefined()
    await $.ui.press({ plugin: 'grammar-tracker', key: 'toggle' })
    expect(calls.opened).toEqual(['grammar'])
    expect(calls.runs.at(-1)?.[2]).toBe('top')
  })
}

test('the band says when the check does not apply', async ($, on) => {
  engine(on, JSON.stringify({ does_not_apply: true }))
  await $.turn.complete(TURN)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ text: 'Grammar check does not apply to the last prompt' })).toBeDefined()
})

test('a failed stop hook shows a toast and a band with no check', async ($, on) => {
  const calls = engine(on, JSON.stringify({ systemMessage: 'Grammar tracker: failed to log (see errors.log)' }))
  await $.turn.complete(TURN)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ text: 'Grammar: no check for the last prompt' })).toBeDefined()
  expect(calls.toasts).toEqual(['Grammar tracker: failed to log (see errors.log)'])
})

test('a stop hook that exits with an error shows its message in a toast', async ($, on) => {
  const calls = engine(on, JSON.stringify(STOP_OUTPUT))
  await $.turn.complete(TURN)
  calls.stdout = ''
  calls.exitCode = 1
  calls.stderr = 'Grammar tracker needs Python 3.10 or newer, found 3.9.6\n'
  await $.turn.complete(TURN)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ text: 'Grammar: no check for the last prompt' })).toBeDefined()
  expect(calls.toasts).toEqual(
    ['Grammar tracker: failed to read the check (Error: Grammar tracker needs Python 3.10 or newer, found 3.9.6)'])
})

test('a turn without a check leaves the band with no check', async ($, on) => {
  const calls = engine(on, JSON.stringify(STOP_OUTPUT))
  await $.turn.complete(TURN)
  calls.stdout = ''
  await $.turn.complete(TURN)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ text: /mistakes/ })).toBeUndefined()
  expect(await band.find({ text: 'Grammar: no check for the last prompt' })).toBeDefined()
})

test('a failed stop hook clears the check of the turn before', async ($, on) => {
  const calls = engine(on, JSON.stringify(STOP_OUTPUT))
  await $.turn.complete(TURN)
  calls.stdout = JSON.stringify({ systemMessage: 'Grammar tracker: failed to log (see errors.log)' })
  await $.turn.complete(TURN)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ text: 'Grammar: no check for the last prompt' })).toBeDefined()
})

test('the scripts run without a data folder from the mod', async ($, on) => {
  const calls = engine(on, JSON.stringify(STOP_OUTPUT))
  await $.turn.complete(TURN)
  await pressBand($)
  expect(calls.runs.map(argv => argv[2])).toEqual([undefined, 'top'])
  expect(calls.inits.every(init => (init as { env?: unknown } | undefined)?.env === undefined)).toBe(true)
})

test('skips subagent turns', async ($, on) => {
  const calls = engine(on, JSON.stringify(STOP_OUTPUT))
  await $.turn.complete({ ...TURN, agentId: 'a1' })
  expect(calls.runs).toEqual([])
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
  engine(on, JSON.stringify(STOP_OUTPUT))
  await $.turn.complete(TURN)
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ text: ' 1 · Article · "the" ×1 ' })).toBeDefined()
  expect(await pane.find({ text: ' 2 · Malformed tense · "does have" ×3 ⟳ ' })).toBeDefined()
  expect(await pane.find({ text: '✗ c' })).toBeDefined()
  expect(await pane.find({ text: '✓ d' })).toBeDefined()
  expect(await pane.find({ text: 'a known remote takes the' })).toBeDefined()
  expect(await pane.find({ text: 'A wrong, missing or extra "a/an" or "the". ("the people are selfish" instead of "people are selfish")' })).toBeDefined()
  expect(await pane.find({ text: 'The right tense built wrong: auxiliaries missing, extra or in the wrong place.' })).toBeDefined()
  expect(await pane.find({ text: ' Corrected prompt ' })).toBeDefined()
})

test('the Last prompt tab leaves out the parentheses for an empty example', async ($, on) => {
  const [first] = STOP_OUTPUT.occurrences
  engine(on, JSON.stringify({ ...STOP_OUTPUT, occurrences: [{ ...first, type_example: '' }] }))
  await $.turn.complete(TURN)
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ text: 'A wrong, missing or extra "a/an" or "the".' })).toBeDefined()
})

test('the Last prompt tab says when there are no mistakes', async ($, on) => {
  engine(on, JSON.stringify({ ...STOP_OUTPUT, occurrences: [] }))
  await $.turn.complete(TURN)
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ text: '✓ No mistakes' })).toBeDefined()
})

test('a Top mistakes row opens and closes its example card', async ($, on) => {
  engine(on, '')
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

test('the Top mistakes tab says when nothing is logged', async ($, on) => {
  const calls = engine(on, '')
  calls.top = '[]'
  await pressBand($)
  const pane = await $.ui.mount(PANE)
  await $.ui.press({ plugin: 'grammar-tracker', key: 'tab-top' })
  expect(await pane.find({ text: 'No mistakes logged yet' })).toBeDefined()
})

test('cell cuts or pads a table cell and bar scales to the largest count', () => {
  expect(cell('article', 4)).toBe('art…')
  expect(cell('the', 5)).toBe('the  ')
  expect(bar(7, 7)).toBe('████████')
  expect(bar(1, 7)).toBe('█')
})

test('the scripts run with py -3 where python3 does not start, as on Windows', async ($, on) => {
  const calls = engine(on, JSON.stringify(STOP_OUTPUT))
  calls.pythons = { python3: '', py: '3' }
  await $.turn.complete(TURN)
  expect(calls.probes).toEqual(['python3', 'py'])
  expect(calls.runs[0]?.slice(0, 2)).toEqual(['py', '-3'])
  expect(calls.runs[0]?.[2]?.endsWith('/grammar-tracker/scripts/stop_hook.py')).toBe(true)
})

test('without Python 3 the stop hook says so in a toast, and a Python installed later is found', async ($, on) => {
  const calls = engine(on, JSON.stringify(STOP_OUTPUT))
  calls.pythons = { python: '2' }
  await $.turn.complete(TURN)
  expect(calls.probes).toEqual(['python3', 'py', 'python'])
  expect(calls.runs).toEqual([])
  expect(calls.toasts[0]).toContain('Grammar tracker needs Python 3.10 or newer as python3, py or python on the PATH')
  calls.pythons = { python: '3' }
  await $.turn.complete(TURN)
  expect(calls.runs[0]?.[0]).toBe('python')
})

test('a Top mistakes row with the largest count and the recurring mark fits the pane', () => {
  for (const largest of [7, 68, 512, 4096]) {
    const mistake = cell('the', mistakeColumn(80, largest))
    const row = `▸ ${cell('1', 3)}${cell('Article', 15)} ${mistake} ${bar(largest, largest)} ${largest} ⟳`
    expect(row.length).toBe(80)
  }
})
