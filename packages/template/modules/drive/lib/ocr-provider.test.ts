import { describe, expect, test } from 'bun:test'

import { parseOcrText } from './ocr-provider'

describe('parseOcrText', () => {
  test('extracts summary + text', () => {
    const raw = '<summary>A receipt for groceries.</summary>\n<text>Apple $1\nMilk $3</text>'
    expect(parseOcrText(raw)).toEqual({
      summary: 'A receipt for groceries.',
      text: 'Apple $1\nMilk $3',
    })
  })

  test('handles missing tags by truncating raw', () => {
    const raw = 'No tags here, just freeform text from the model.'
    const result = parseOcrText(raw)
    expect(result.summary.length).toBeGreaterThan(0)
    expect(result.text).toBe(raw)
  })

  test('handles empty text block', () => {
    const raw = '<summary>An abstract painting.</summary>\n<text></text>'
    expect(parseOcrText(raw)).toEqual({ summary: 'An abstract painting.', text: '' })
  })
})
