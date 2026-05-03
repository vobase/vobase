/**
 * Regression test for the `INBOUND_TO_WAKE_JOB` → `AGENTS_WAKE_JOB` rename.
 *
 * The wake bus carries every conversation-lane producer (channel inbound,
 * card replies, drive `caption_ready` post-OCR re-wakes). The old name
 * (`channels:inbound-to-wake`) implied channel-only ownership, which was
 * already untrue when drive started piggy-backing on it. This test pins
 * the new name + its symbol so future drift surfaces here.
 */

import { describe, expect, it } from 'bun:test'

import * as inboundModule from './inbound'

describe('agents:wake job rename (was channels:inbound-to-wake)', () => {
  it('exports AGENTS_WAKE_JOB with the new queue name', () => {
    expect(inboundModule.AGENTS_WAKE_JOB).toBe('agents:wake')
  })

  it('does not re-export the old constant under the legacy name', () => {
    const exports = inboundModule as Record<string, unknown>
    expect(exports.INBOUND_TO_WAKE_JOB).toBeUndefined()
    expect(exports.InboundToWakePayloadSchema).toBeUndefined()
    expect(exports.InboundToWakePayload).toBeUndefined()
  })

  it('does not bind the legacy queue string anywhere in the module', () => {
    // Defensive: no stale fallback const should still hold the old value.
    const values = Object.values(inboundModule)
    expect(values).not.toContain('channels:inbound-to-wake')
  })

  it('exposes the renamed payload schema for runtime validation', () => {
    expect(typeof inboundModule.AgentsWakePayloadSchema.parse).toBe('function')
    const parsed = inboundModule.AgentsWakePayloadSchema.parse({
      organizationId: 'org_x',
      conversationId: 'conv_x',
      contactId: 'ctt_x',
      messageId: 'msg_x',
    })
    expect(parsed.organizationId).toBe('org_x')
  })
})
