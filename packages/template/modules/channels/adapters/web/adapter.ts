/**
 * Web channel adapter — implements `ChannelAdapter` from `@vobase/core`.
 *
 * Inbound for web is session-authed (or HMAC) and doesn't go through the
 * generic webhook router (see `handlers/inbound.ts`); the contract methods
 * `verifyWebhook`/`parseWebhook` are unused. `send()` writes to the realtime
 * NOTIFY bus so connected SSE subscribers push the message to browsers.
 */

import type { ChannelAdapter, ChannelCapabilities, OutboundMessage, SendResult } from '@vobase/core'

export const WEB_CHANNEL_NAME = 'web'

export const WEB_CAPABILITIES: ChannelCapabilities = {
  templates: false,
  media: true,
  reactions: false,
  readReceipts: false,
  typingIndicators: false,
  streaming: true,
  messagingWindow: false,
}

export function createWebAdapter(_config: Record<string, unknown>, _instanceId: string): ChannelAdapter {
  return {
    name: WEB_CHANNEL_NAME,
    inboundMode: 'push',
    capabilities: WEB_CAPABILITIES,
    deliveryModel: 'realtime',
    contactIdentifierField: 'identifier',
    debounceWindowMs: 0,

    send(_message: OutboundMessage): Promise<SendResult> {
      // Web channel has no upstream provider — the row-level NOTIFY fired by
      // `appendXxxMessage()` in the generic outbound dispatcher is what pushes
      // the message to connected browsers. No work to do here.
      return Promise.resolve({ success: true })
    },
  }
}
