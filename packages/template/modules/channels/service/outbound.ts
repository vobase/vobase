/**
 * Outbound dispatch seam.
 *
 * Tools (and `sendStaffReply`) persist their message row first, then call
 * `sendOutbound` to push it onto the wire via the channel adapter. This file
 * does NOT persist — the one-write-path lives in `messaging/service/messages`.
 *
 * The default implementation resolves the channel adapter via the registry,
 * enforces the 24h messaging window for windowed channels, and calls
 * `adapter.send()`. The web adapter's `send()` is a no-op so it goes through
 * the same seam.
 *
 * Tests install a no-op implementation via `installOutboundService` so unit
 * tests don't need contacts/conversations/instance fixtures.
 */

import { getInstance } from '@modules/channels/service/instances'
import { get as getContact } from '@modules/contacts/service/contacts'
import { get as getConversation } from '@modules/messaging/service/conversations'
import { checkWindow } from '@modules/messaging/service/sessions'
import type { CardElement } from '@modules/messaging/tools/send-card'
import type { OutboundMedia, OutboundMessage, SendResult } from '@vobase/core'

import type { OutboundToolName } from '~/runtime/channel-events'
import { get as registryGet } from './registry'

export interface SendOutboundInput {
  /**
   * Tenant scope of the caller. Asserted against every row resolved here
   * (conversation, contact, channel instance) so a wake on org-A cannot
   * reach org-B's wire by passing a foreign conversationId — managed-mode
   * adapters sign with per-org vault keys, so a cross-tenant reference would
   * cross the tenant trust boundary.
   */
  organizationId: string
  conversationId: string
  /** Already-persisted message row id — passed for log/correlation only. */
  persisted: { id: string }
  toolName: OutboundToolName
  payload: unknown
}

export interface OutboundService {
  sendOutbound(input: SendOutboundInput): Promise<SendResult>
}

// ─── WhatsApp interactive constraints ────────────────────────────────────────

/** Max chars in a WhatsApp interactive header text. */
export const WA_HEADER_MAX = 60
/** Max chars in a WhatsApp interactive body text. */
export const WA_BODY_MAX = 1024
/** Max chars in a WhatsApp button reply title (type=button). */
export const WA_BUTTON_TITLE_MAX = 20
/** Max chars in a WhatsApp list row title. */
export const WA_ROW_TITLE_MAX = 24
/** Max reply buttons before switching to list interactive. */
export const WA_BUTTON_MAX = 3
/** Max rows in a WhatsApp list interactive (hard limit). */
export const WA_LIST_ROW_MAX = 10

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

/**
 * Convert a `CardElement` to an `OutboundMessage` for the registered channel
 * adapter. WhatsApp emits `metadata.interactive` (button ≤3, list 4-10);
 * other channels fall back to plain text. Footer is intentionally not
 * auto-promoted — the schema has no footer signal and heuristics misclassify
 * normal prose as footer on WhatsApp.
 */
export function cardToOutbound(card: CardElement, recipient: string, channelKind: string): OutboundMessage {
  const bodyParts: string[] = []
  const buttons: Array<{ id: string; label: string }> = []

  for (const child of card.children) {
    switch (child.type) {
      case 'text':
        bodyParts.push(child.content)
        break
      case 'fields':
        bodyParts.push(child.children.map((f) => `*${f.label}*: ${f.value}`).join('\n'))
        break
      case 'link':
        bodyParts.push(`${child.label}: ${child.url}`)
        break
      case 'image':
        bodyParts.push(`[Image${child.alt ? `: ${child.alt}` : ''}] ${child.url}`)
        break
      case 'divider':
        bodyParts.push('—')
        break
      case 'actions':
        if (buttons.length > 0) break
        for (const action of child.children) {
          if (action.type === 'button') {
            buttons.push({ id: action.id, label: action.label })
          } else if (action.type === 'link-button') {
            // WA interactive can't mix reply buttons with a CTA url; surface as labelled URL.
            bodyParts.push(`${action.label}: ${action.url}`)
          }
        }
        break
      default:
        child satisfies never
    }
  }

  if (channelKind !== 'whatsapp' || buttons.length === 0) {
    const parts = [card.title, ...bodyParts, ...buttons.map((b) => `[${b.label}]`)].filter(Boolean)
    return { to: recipient, text: parts.join('\n\n') || '[card]' }
  }

  const header = card.title ? { type: 'text' as const, text: truncate(card.title, WA_HEADER_MAX) } : undefined

  // Body is required on WA interactive — fall back to title or single space when only buttons were sent.
  const rawBody = bodyParts.length > 0 ? bodyParts.join('\n\n') : (card.title ?? ' ')
  const body = { text: truncate(rawBody, WA_BODY_MAX) }

  let effectiveButtons = buttons
  if (buttons.length > WA_LIST_ROW_MAX) {
    console.warn(
      `channels/outbound: card has ${buttons.length} buttons — WhatsApp list max is ${WA_LIST_ROW_MAX}. Truncating.`,
    )
    effectiveButtons = buttons.slice(0, WA_LIST_ROW_MAX)
  }

  if (effectiveButtons.length <= WA_BUTTON_MAX) {
    // type=button interactive (≤3 reply buttons).
    const interactive = {
      type: 'button' as const,
      ...(header && { header }),
      body,
      action: {
        buttons: effectiveButtons.map((b) => ({
          type: 'reply' as const,
          reply: { id: b.id, title: truncate(b.label, WA_BUTTON_TITLE_MAX) },
        })),
      },
    }
    return { to: recipient, metadata: { interactive } }
  }

  // type=list interactive (4-10 rows).
  const interactive = {
    type: 'list' as const,
    ...(header && { header }),
    body,
    action: {
      button: 'Choose an option',
      sections: [
        {
          rows: effectiveButtons.map((b) => ({
            id: b.id,
            title: truncate(b.label, WA_ROW_TITLE_MAX),
          })),
        },
      ],
    },
  }
  return { to: recipient, metadata: { interactive } }
}

function buildOutboundMessage(input: SendOutboundInput, recipient: string, channelKind: string): OutboundMessage {
  if (input.toolName === 'reply_contact' || input.toolName === 'staff_reply') {
    const payload = input.payload as { text: string }
    return { to: recipient, text: payload.text }
  }
  if (input.toolName === 'send_card') {
    return cardToOutbound(input.payload as CardElement, recipient, channelKind)
  }
  if (input.toolName === 'send_file') {
    const payload = input.payload as { media: OutboundMedia }
    return { to: recipient, media: [payload.media] }
  }
  return { to: recipient, text: `[${input.toolName}]:${input.persisted.id}` }
}

function defaultContactIdentifierField(channel: string): 'phone' | 'email' | 'identifier' {
  if (channel === 'whatsapp') return 'phone'
  if (channel === 'email') return 'email'
  return 'identifier'
}

/**
 * Throw if a `SendResult` indicates failure so the harness journal records
 * the tool call as failed and the agent can react. `window_expired` gets a
 * dedicated message that nudges the agent toward a pre-approved template.
 */
export function throwIfFailed(result: SendResult, toolName: string): void {
  if (result.success) return
  if (result.code === 'window_expired') {
    throw new Error(
      `${toolName}: 24h messaging window expired — fall back to a pre-approved template via send_card or alert staff.`,
    )
  }
  const detail = [result.code, result.error].filter(Boolean).join(': ') || 'send failed'
  throw new Error(`${toolName}: ${detail}`)
}

export function createOutboundService(): OutboundService {
  async function sendOutbound(input: SendOutboundInput): Promise<SendResult> {
    // Resolve the channel instance via the conversation row, then build the
    // recipient address from the contact's preferred channel handle. Every
    // resolved row's `organizationId` is asserted against the caller's scope
    // so cross-tenant references throw before reaching the wire.
    const conv = await getConversation(input.conversationId)
    if (conv.organizationId !== input.organizationId) {
      throw new Error('channels/outbound: cross-tenant conversation reference rejected')
    }
    const contact = await getContact(conv.contactId)
    if (contact.organizationId !== input.organizationId) {
      throw new Error('channels/outbound: contact org mismatch')
    }
    const instance = await getInstance(conv.channelInstanceId)
    if (!instance) {
      throw new Error(`channels/outbound: instance ${conv.channelInstanceId} not found`)
    }
    if (instance.organizationId !== input.organizationId) {
      throw new Error('channels/outbound: channel instance org mismatch')
    }

    const adapter = await registryGet(instance.channel, instance.config, instance.id)
    if (!adapter) {
      throw new Error(`channels/outbound: no adapter registered for "${instance.channel}"`)
    }

    // Channel-aware recipient resolution. Adapters declare which contact
    // field carries their wire address; defaults cover phone/email/identifier
    // for unmapped channels. Never silently fall back to `contact.id` (a
    // nanoid) for a channel that puts bytes on a wire — `whatsapp`/`email`
    // would 400 with a useless error. The `web` adapter's `send()` is a
    // no-op, so the recipient string isn't used there; we still keep the
    // contract consistent and let `contact.id` stand in when no `phone`/
    // `email`/`identifier` column exists (the contacts schema tracks
    // identity via `phone`/`email` only — no `identifier` column).
    const field = adapter.contactIdentifierField ?? defaultContactIdentifierField(instance.channel)
    let recipient: string
    if (field === 'phone' || field === 'email') {
      const value = contact[field]
      if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`channels/outbound: contact ${contact.id} has no ${field} for ${instance.channel} channel`)
      }
      recipient = value
    } else {
      // 'identifier' — no dedicated contacts column; the web channel's send()
      // is a no-op so the value is never put on a wire. Fall back to
      // contact.id rather than throw — keeps the contract uniform across
      // adapters that don't need a wire address.
      recipient = contact.id
    }

    // Enforce 24h messaging window for windowed channels (e.g. WhatsApp).
    // Message row already persisted for audit; return window_expired result
    // without calling the wire so the agent can fall back to a template.
    if (adapter.capabilities.messagingWindow) {
      const win = await checkWindow(input.conversationId)
      if (!win.open) {
        return { success: false, code: 'window_expired' }
      }
    }

    const outbound = buildOutboundMessage(input, recipient, instance.channel)
    return adapter.send(outbound)
  }

  return { sendOutbound }
}

let _currentOutboundService: OutboundService | null = null

export function installOutboundService(svc: OutboundService): void {
  _currentOutboundService = svc
}

export function __resetOutboundServiceForTests(): void {
  _currentOutboundService = null
}

function currentOutbound(): OutboundService {
  if (!_currentOutboundService) {
    throw new Error('channels/outbound: service not installed — call installOutboundService()')
  }
  return _currentOutboundService
}

// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function sendOutbound(input: SendOutboundInput): Promise<SendResult> {
  return currentOutbound().sendOutbound(input)
}
