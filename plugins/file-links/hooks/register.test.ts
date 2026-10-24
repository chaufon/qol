import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, Register } from 'claude-code'

import { sameFiles } from './register'

const REPLY = 'Edit `src/app.ts:4`.'
const TURN = { answer: 'reply', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const
const PANE_PROPS = {
  title: 'logo.png', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 10 }, view: {},
} as const

// A project in `cwd` with one tracked file, `src/app.ts`, and a binary `/proj/logo.png` on disk.
function engine(on: On, cwd = '/proj') {
  const calls = { lsFiles: 0, stats: 0, opened: 0, toasts: [] as string[] }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: cwd }))
  on('process.run', () => {
    calls.lsFiles++
    return { value: { exitCode: 0, stdout: 'src/app.ts\0', stderr: '', isStdoutTruncated: false,
                      isStderrTruncated: false } }
  })
  on('fs.stat', ($, e) => {
    calls.stats++
    if (e.path !== '/proj/logo.png') throw new Error(`${e.path}: no such file`)
    return { value: { kind: 'file', size: 6, mtimeMs: 0, isLink: false, realPath: e.path } }
  })
  on('fs.read', ($, e) => ({ value: e.path.endsWith('.png') ? '\x89PNG\0\0' : 'a\nb\nc\nd\n' }))
  on('ui.open', () => { calls.opened++; return { value: { isPlaced: true } } })
  on('turn.complete', () => ({ text: 'reply' }))
  on('ui.toast', ($, e) => { calls.toasts.push(e.text); return { value: undefined } })
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: e.component === 'AssistantMessage' ? e.props.text : '' }))
  return calls
}

// A reply that opens with grammar-tracker's check, which that mod hides.
const CHECKED = '**English grammar check:** One `src/app.ts` mistake.\n\n```grammar-json\n{}\n```\n\nEdit `src/app.ts:4`.'

// Stands in for grammar-tracker: hands the reply on without its check.
const grammarTracker: Register = on => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) =>
    next({ ...e, props: { ...e.props, text: e.props.text.replace(/^[\s\S]*?```grammar-json\n[\s\S]*?\n```\s*/, '') } }))
}

// A mod that draws every reply itself.
const drawer: Register = on => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => $.ui.resolve(e).Text({ children: 'drawn by drawer' }))
}

function drawReply($: Engine, text: string, isFullscreen: boolean, requestId = 'm1') {
  return $.ui.mount({ plugin: 'file-links', surface: 'terminal', component: 'AssistantMessage', requestId,
                      viewport: { columns: 80, rows: 24, isFullscreen }, props: { text, isFirstOfReply: true } })
}

test('sameFiles compares two file lists', () => {
  expect(sameFiles(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true)
  expect(sameFiles(new Set(['a']), new Set(['a', 'b']))).toBe(false)
  expect(sameFiles(new Set(['a', 'c']), new Set(['a', 'b']))).toBe(false)
})

test('the fullscreen terminal links a reply, other surfaces draw it as written', async ($, on) => {
  const calls = engine(on)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  expect(await (await drawReply($, REPLY, false)).find({ text: REPLY })).toBeDefined()
  expect(await (await drawReply($, REPLY, true, 'm2')).find({ key: 'reply-m2' })).toBeDefined()
  expect(calls.toasts).toEqual([])
})

test('a Windows session links paths written with backslashes', async ($, on) => {
  engine(on, 'C:\\proj')
  await $.session.start({ cwd: 'C:\\proj', surface: 'terminal', isInteractive: true })
  const markdown = await (await drawReply($, 'Edit `src\\app.ts:4`.', true)).find({ key: 'reply-m1' })
  expect(markdown?.text).toBe('Edit [`src\\app.ts:4`](file:///C:/proj/src/app.ts#L4).')
})

test('a turn that changes no file leaves drawn replies alone', async ($, on) => {
  const calls = engine(on)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  const reply = await drawReply($, 'See /proj/logo.png.', true)
  expect(calls.stats).toBe(1)
  await $.turn.complete(TURN)
  await reply.drawn()
  expect(calls.lsFiles).toBe(2)
  expect(calls.stats).toBe(1)
})

test('the pane refuses a binary file', async ($, on) => {
  const calls = engine(on)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  const pane = await $.ui.mount({ plugin: 'file-links', surface: 'terminal', component: 'Pane', requestId: 'file-links',
                                  props: PANE_PROPS })
  const reply = await drawReply($, 'See /proj/logo.png.', true)
  // A press does not reach the test's ui.scroll answer, so the scroll after the pane opens rejects.
  await reply.press({ key: 'reply-m1', link: { href: 'file:///proj/logo.png' } }).catch(() => undefined)
  expect(calls.opened).toBe(1)
  expect(await pane.find({ text: 'logo.png: binary file, not shown' })).toBeDefined()
})

for (const tier of ['prepend', 'append'] as const) {
  test(`the reply is linked after grammar-tracker hides its check (grammar-tracker ${tier === 'prepend' ? 'outside' : 'inside'})`,
       { plugins: [{ name: 'grammar-tracker', tier, register: grammarTracker }] }, async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
    const reply = await drawReply($, CHECKED, true)
    const markdown = await reply.find({ key: 'reply-m1' })
    expect(markdown?.text).toBe('Edit [`src/app.ts:4`](file:///proj/src/app.ts#L4).')
  })
}

test('a mod beneath that draws the reply itself keeps it, and a toast names it once',
     { plugins: [{ name: 'drawer', tier: 'append', register: drawer }] }, async ($, on) => {
  const calls = engine(on)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  expect(await (await drawReply($, REPLY, true)).find({ text: 'drawn by drawer' })).toBeDefined()
  await drawReply($, REPLY, true, 'm2')
  expect(calls.toasts).toEqual(["file-links: drawer draws Claude's replies itself, so file references in them are not links"])
})
