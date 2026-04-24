import { describe, expect, it } from 'bun:test'

import { classifyError } from './classify-error'

describe('classifyError', () => {
  it('context_overflow: HTTP 400 with context_length_exceeded code', () => {
    const err = Object.assign(new Error("This model's maximum context length is 128000 tokens"), {
      status: 400,
      code: 'context_length_exceeded',
    })
    const result = classifyError(err)
    expect(result.reason).toBe('context_overflow')
    expect(result.httpStatus).toBe(400)
    expect(result.providerMessage).toContain('maximum context length')
  })

  it('payload_too_large: HTTP 413', () => {
    const err = Object.assign(new Error('Request payload too large'), { status: 413 })
    const result = classifyError(err)
    expect(result.reason).toBe('payload_too_large')
    expect(result.httpStatus).toBe(413)
  })

  it('transient/network: fetch failed (connection reset)', () => {
    const err = new Error('fetch failed: ECONNRESET')
    const result = classifyError(err)
    expect(result.reason).toBe('transient')
    expect(result.httpStatus).toBeUndefined()
  })

  it('transient/timeout: AbortError', () => {
    const err = new Error('The operation was aborted')
    err.name = 'AbortError'
    const result = classifyError(err)
    expect(result.reason).toBe('transient')
    expect(result.httpStatus).toBeUndefined()
  })

  it('unknown: novel unrecognized error never coerces to transient', () => {
    const err = Object.assign(new Error('unexpected_provider_error: flux capacitor overload'), { status: 418 })
    const result = classifyError(err)
    expect(result.reason).toBe('unknown')
    expect(result.httpStatus).toBe(418)
  })
})
