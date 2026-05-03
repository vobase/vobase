/**
 * Step 14 acceptance — `caption_ready` end-to-end shape.
 *
 * Asserts the producer-to-consumer wiring of the new wake trigger:
 *   1. The `WakeTriggerSchema` validates a `caption_ready` payload.
 *   2. `wake/trigger.ts:REGISTRY['caption_ready'].render` produces the
 *      first-turn cue pointing the agent back at messages.md.
 *   3. `AgentsWakePayloadSchema` accepts a payload that omits
 *      `messageId` but carries an explicit `caption_ready` trigger,
 *      mirroring what `modules/drive/jobs.ts` enqueues post-OCR.
 *
 * The full wake-handler boot is covered indirectly by every other
 * conversation-lane wake test that exercises `createWakeHandler`'s
 * trigger-forwarding seam.
 */

import { describe, expect, it } from 'bun:test'

import { type WakeTrigger, WakeTriggerSchema } from '~/wake/events'
import { AgentsWakePayloadSchema } from '~/wake/inbound'
import { resolveTriggerSpec } from '~/wake/trigger'

describe('caption_ready wake trigger — Step 11a wiring', () => {
  it('WakeTriggerSchema accepts a caption_ready variant', () => {
    const parsed = WakeTriggerSchema.parse({
      trigger: 'caption_ready',
      conversationId: 'conv-x',
      fileId: 'f-1',
    })
    expect(parsed.trigger).toBe('caption_ready')
  })

  it('REGISTRY["caption_ready"] is conversation-lane and renders the first-turn cue', () => {
    const spec = resolveTriggerSpec('caption_ready')
    expect(spec.lane).toBe('conversation')
    expect(spec.logPrefix).toBe('wake:conv')
    const cue = spec.render(
      { trigger: 'caption_ready', conversationId: 'conv-x', fileId: 'f-1' } satisfies WakeTrigger,
      { contactId: 'ctt0test00', channelInstanceId: 'chi0cust00' },
    )
    expect(cue).toContain('Caption ready for file f-1')
    expect(cue).toContain('/contacts/ctt0test00/chi0cust00/messages.md')
  })

  it('AgentsWakePayloadSchema accepts caption_ready payload without messageId', () => {
    const parsed = AgentsWakePayloadSchema.parse({
      organizationId: 'org-1',
      conversationId: 'conv-x',
      contactId: 'ctt-1',
      trigger: { trigger: 'caption_ready', conversationId: 'conv-x', fileId: 'f-1' },
    })
    expect(parsed.messageId).toBeUndefined()
    expect(parsed.trigger?.trigger).toBe('caption_ready')
  })
})
