/**
 * V2ChannelAdapter — a refinement of @vobase/core's ChannelAdapter.
 *
 * Design rules (A7):
 *   - NEVER override core's `send(message: OutboundMessage)` — that would produce a
 *     method-signature mismatch with `OutboundMessage` vs `ChannelOutboundEvent` and
 *     break cross-template code paths.
 *   - V2 adds a NEW method `sendOutboundEvent` that carries v2-specific fields
 *     (tenantId, contactId, wakeId) from the ChannelOutboundEvent envelope.
 *     Channel-web and channel-whatsapp implement this method; the dispatcher calls it.
 *
 * Usage: modules/channel-web and modules/channel-whatsapp implement V2ChannelAdapter.
 * PluginContext.registerChannel() continues to accept the core ChannelAdapter supertype;
 * callers that need sendOutboundEvent narrow the type at the call site.
 */

import type { ChannelAdapter, SendResult } from '@vobase/core'
import type { ChannelOutboundEvent } from './channel-event'

export interface V2ChannelAdapter extends ChannelAdapter {
  /**
   * Dispatch a v2 outbound event to the underlying channel transport.
   *
   * Called by the outbound dispatcher AFTER InboxPort has persisted the message row
   * (one-write-path discipline). This method is TRANSPORT-ONLY — it must not write
   * to the `messages` table directly.
   */
  sendOutboundEvent(event: ChannelOutboundEvent): Promise<SendResult>
}

export type { ChannelAdapter, SendResult }
