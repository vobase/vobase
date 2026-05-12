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

/**
 * Trailing-edge debounce window for inbound wakes on the web channel. Each new
 * customer message within this window resets the scheduler's timer (see
 * `runtime/bootstrap.ts:131-145`); rapid quick-reply taps coalesce into one
 * wake that reads the full burst from `messaging.messages` at boot.
 */
export const WEB_DEBOUNCE_WINDOW_MS = 1000

export const WEB_CAPABILITIES: ChannelCapabilities = {
  templates: false,
  media: true,
  reactions: false,
  readReceipts: false,
  typingIndicators: false,
  streaming: true,
  messagingWindow: false,
  nativeThreading: false,
}

export function createWebAdapter(_config: Record<string, unknown>, _instanceId: string): ChannelAdapter {
  return {
    name: WEB_CHANNEL_NAME,
    inboundMode: 'push',
    capabilities: WEB_CAPABILITIES,
    deliveryModel: 'realtime',
    contactIdentifierField: 'identifier',
    debounceWindowMs: WEB_DEBOUNCE_WINDOW_MS,

    send(_message: OutboundMessage): Promise<SendResult> {
      // Web channel has no upstream provider — the row-level NOTIFY fired by
      // `appendXxxMessage()` in the generic outbound dispatcher is what pushes
      // the message to connected browsers. No work to do here.
      return Promise.resolve({ success: true })
    },
  }
}
