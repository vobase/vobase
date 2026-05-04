/**
 * Unit tests for the trust-aware source-IP parser.
 *
 * The threat model: an attacker controls `X-Forwarded-For` directly via the
 * client request. With `TRUST_PROXY_HOPS=0` we MUST ignore XFF entirely so
 * spoofed buckets don't deflate our per-IP rate limit. With `N>0` we trust
 * the Nth-from-right entry (the real client IP after `N` trusted reverse
 * proxies have appended their observation).
 */
import { afterEach, describe, expect, it } from 'bun:test'

import { sourceIpFromHeaders } from './request-ip'

const ORIGINAL = process.env.TRUST_PROXY_HOPS

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.TRUST_PROXY_HOPS
  else process.env.TRUST_PROXY_HOPS = ORIGINAL
})

function headers(init: Record<string, string>) {
  return new Headers(init)
}

describe('sourceIpFromHeaders — TRUST_PROXY_HOPS=0 (default)', () => {
  it('ignores spoofed XFF, returns x-real-ip', () => {
    delete process.env.TRUST_PROXY_HOPS
    const ip = sourceIpFromHeaders(headers({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '10.0.0.1' }))
    expect(ip).toBe('10.0.0.1')
  })

  it('falls back to peerIp when no x-real-ip', () => {
    delete process.env.TRUST_PROXY_HOPS
    const ip = sourceIpFromHeaders(headers({ 'x-forwarded-for': 'attacker' }), { peerIp: '192.0.2.5' })
    expect(ip).toBe('192.0.2.5')
  })

  it('returns "unknown" when no source available', () => {
    delete process.env.TRUST_PROXY_HOPS
    expect(sourceIpFromHeaders(headers({}))).toBe('unknown')
  })
})

describe('sourceIpFromHeaders — TRUST_PROXY_HOPS=1 (one trusted proxy)', () => {
  it('returns rightmost XFF entry', () => {
    process.env.TRUST_PROXY_HOPS = '1'
    const ip = sourceIpFromHeaders(headers({ 'x-forwarded-for': 'attacker, 10.0.0.1' }))
    expect(ip).toBe('10.0.0.1')
  })

  it('with single XFF entry returns it', () => {
    process.env.TRUST_PROXY_HOPS = '1'
    expect(sourceIpFromHeaders(headers({ 'x-forwarded-for': '10.0.0.1' }))).toBe('10.0.0.1')
  })

  it('falls back to x-real-ip when XFF missing', () => {
    process.env.TRUST_PROXY_HOPS = '1'
    expect(sourceIpFromHeaders(headers({ 'x-real-ip': '10.0.0.2' }))).toBe('10.0.0.2')
  })
})

describe('sourceIpFromHeaders — TRUST_PROXY_HOPS=2 (two trusted proxies)', () => {
  it('returns second-from-right entry', () => {
    process.env.TRUST_PROXY_HOPS = '2'
    const ip = sourceIpFromHeaders(headers({ 'x-forwarded-for': 'attacker, 10.0.0.1, 10.0.0.2' }))
    expect(ip).toBe('10.0.0.1')
  })
})

describe('sourceIpFromHeaders — invalid TRUST_PROXY_HOPS', () => {
  it('treats negative as 0', () => {
    process.env.TRUST_PROXY_HOPS = '-1'
    const ip = sourceIpFromHeaders(headers({ 'x-forwarded-for': 'attacker', 'x-real-ip': '10.0.0.1' }))
    expect(ip).toBe('10.0.0.1')
  })

  it('treats non-numeric as 0', () => {
    process.env.TRUST_PROXY_HOPS = 'banana'
    const ip = sourceIpFromHeaders(headers({ 'x-forwarded-for': 'attacker', 'x-real-ip': '10.0.0.1' }))
    expect(ip).toBe('10.0.0.1')
  })
})
