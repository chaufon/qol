import { expect, test } from 'claude-code/testing'

import { checkState, stripCheck } from './check'

test('stripCheck removes the check and its grammar-json block', () => {
  const text = '**English grammar check:**\n```grammar-json\n{"mistakes": []}\n```\n\nThe answer.'
  expect(stripCheck(text)).toBe('The answer.')
})

test('stripCheck removes the "does not apply" paragraph', () => {
  expect(stripCheck('English grammar check does not apply.\n\nThe answer.')).toBe('The answer.')
  expect(stripCheck('**English grammar check:** English grammar check does not apply.\n\nThe answer.')).toBe(
    'The answer.',
  )
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
