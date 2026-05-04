import { timingSafeEqual } from 'node:crypto'

import type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelEvent,
  OutboundMessage,
  SendResult,
  StatusUpdateEvent,
} from '../../../contracts/channels'
import type { HttpClient } from '../../../http/client'
import { chunkText, createApiClient, errorToSendResult } from './api'
import { createManagementOperations } from './management'
import type { WhatsAppWebhookPayload } from './shared'
import { parseWhatsAppMessages, parseWhatsAppStatuses, shouldUpdateStatus } from './shared'
import { createTemplateOperations } from './templates'
import type { WhatsAppChannelConfig } from './types'
import {
  type CreateTemplateInput,
  DEFAULT_MEDIA_SIZE_LIMIT,
  EVICTION_TTL_MS,
  MAX_MAP_SIZE,
  MEDIA_SIZE_LIMITS,
  type WhatsAppTemplate,
} from './types'

// ─── Factory ─────────────────────────────────────────────────────────

export function createWhatsAppAdapter(
  config: WhatsAppChannelConfig,
  httpClient?: HttpClient,
): ChannelAdapter & {
  markAsRead(messageId: string): Promise<void>
  syncTemplates(): Promise<WhatsAppTemplate[]>
  healthCheck(): Promise<{ ok: boolean; error?: string }>
  checkWebhookSubscription(): Promise<{ subscribed: boolean; callbackUrl?: string; error?: string }>
  tokenStatus(): { valid: boolean; expiresAt?: Date; daysRemaining?: number }
  createTemplate(template: CreateTemplateInput): Promise<{ id: string; status: string }>
  deleteTemplate(name: string): Promise<void>
  getTemplate(name: string): Promise<WhatsAppTemplate | null>
  getMessagingTier(): Promise<{ tier: string; qualityRating: string }>
  registerWebhook(callbackUrl: string, verifyToken: string): Promise<void>
  deregisterWebhook(): Promise<void>
} {
  const { phoneNumberId, appSecret } = config
  const transport = config.transport

  // Compose sub-modules
  const api = createApiClient(config, httpClient)
  const { graphFetch, transportFetch, downloadMedia } = api
  const templateOps = createTemplateOperations(graphFetch, phoneNumberId)
  const managementOps = createManagementOperations(config, graphFetch)

  // ─── Dedup state ────────────────────────────────────────────────

  const sentTimestamps = new Map<string, number>()

  function addRecentlySent(waMessageId: string): void {
    sentTimestamps.set(waMessageId, Date.now())
    const now = Date.now()
    for (const [id, ts] of sentTimestamps) {
      if (now - ts > EVICTION_TTL_MS) {
        sentTimestamps.delete(id)
      }
    }
  }

  function isRecentlySent(waMessageId: string): boolean {
    const ts = sentTimestamps.get(waMessageId)
    if (!ts) return false
    if (Date.now() - ts > EVICTION_TTL_MS) {
      sentTimestamps.delete(waMessageId)
      return false
    }
    return true
  }

  // ─── Status dedup ───────────────────────────────────────────────
  const statusDedup = new Map<string, number>()

  let lastEviction = 0
  function evictStaleEntries(map: Map<string, number | { ts: number }>): void {
    const now = Date.now()
    if (now - lastEviction < 5_000) return
    lastEviction = now
    for (const [k, v] of map) {
      const ts = typeof v === 'number' ? v : v.ts
      if (now - ts > EVICTION_TTL_MS) map.delete(k)
    }
  }

  function isStatusDuplicate(messageId: string, status: string): boolean {
    const key = `${messageId}:${status}`
    const now = Date.now()

    evictStaleEntries(statusDedup)

    if (statusDedup.has(key)) return true

    if (statusDedup.size >= MAX_MAP_SIZE) {
      const firstKey = statusDedup.keys().next().value
      if (firstKey) statusDedup.delete(firstKey)
    }

    statusDedup.set(key, now)
    return false
  }

  // ─── Status high-water ──────────────────────────────────────────
  const statusHighWater = new Map<string, { status: string; ts: number }>()

  function getHighWater(messageId: string): string | null {
    const entry = statusHighWater.get(messageId)
    if (!entry) return null
    if (Date.now() - entry.ts > EVICTION_TTL_MS) {
      statusHighWater.delete(messageId)
      return null
    }
    return entry.status
  }

  function setHighWater(messageId: string, status: string): void {
    if (statusHighWater.size >= MAX_MAP_SIZE) {
      let oldestTs = Infinity
      let oldestKey = ''
      for (const [k, v] of statusHighWater) {
        if (v.ts < oldestTs) {
          oldestTs = v.ts
          oldestKey = k
        }
      }
      if (oldestKey) statusHighWater.delete(oldestKey)
    }
    statusHighWater.set(messageId, { status, ts: Date.now() })
  }

  // ─── Webhook verification ──────────────────────────────────────

  async function verifyWebhook(request: Request): Promise<boolean> {
    if (transport) return true

    const signature = request.headers.get('x-hub-signature-256')
    if (!signature || signature.length === 0) return false
    if (!signature.startsWith('sha256=')) return false

    const rawBody = await request.clone().text()
    const expectedSig = new Bun.CryptoHasher('sha256', appSecret).update(rawBody).digest('hex')
    const expected = `sha256=${expectedSig}`

    try {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    } catch {
      return false
    }
  }

  // ─── Webhook challenge ─────────────────────────────────────────

  function handleWebhookChallenge(request: Request): Response | null {
    const url = new URL(request.url)
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')

    const expectedToken = config.webhookVerifyToken ?? process.env.META_WEBHOOK_VERIFY_TOKEN

    if (mode === 'subscribe' && challenge) {
      if (expectedToken && token !== expectedToken) {
        return new Response('Forbidden', { status: 403 })
      }
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    return null
  }

  // ─── Webhook parsing ───────────────────────────────────────────

  async function parseWebhook(request: Request): Promise<ChannelEvent[]> {
    let payload: WhatsAppWebhookPayload
    try {
      payload = (await request.clone().json()) as WhatsAppWebhookPayload
    } catch {
      return []
    }

    if (payload.object !== 'whatsapp_business_account') return []

    // ── Parallel media pre-fetch ───────────────────────────────────────
    const mediaFetchList: Array<{ msgId: string; mediaId: string; mediaType: string }> = []
    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        for (const msg of change.value.messages ?? []) {
          for (const mtype of ['image', 'document', 'audio', 'video', 'sticker'] as const) {
            const mediaId = msg[mtype]?.id
            if (mediaId) {
              mediaFetchList.push({ msgId: msg.id, mediaId, mediaType: mtype })
              break
            }
          }
        }
      }
    }

    const downloadSettled = await Promise.allSettled(
      mediaFetchList.map(({ mediaId, mediaType }) => downloadMedia(mediaId, mediaType)),
    )

    const mediaCache = new Map<string, { data: Buffer; mimeType: string } | null>()
    const failedMediaIds = new Set<string>()
    for (let i = 0; i < mediaFetchList.length; i++) {
      const { mediaId } = mediaFetchList[i]
      const settled = downloadSettled[i]
      const value = settled.status === 'fulfilled' ? settled.value : null
      mediaCache.set(mediaId, value)
      if (!value) failedMediaIds.add(mediaId)
    }

    const msgToMediaId = new Map(mediaFetchList.map(({ msgId, mediaId }) => [msgId, mediaId]))
    const cachedDownloader = async (mediaId: string) => mediaCache.get(mediaId) ?? null

    const messageEvents = await parseWhatsAppMessages(payload, cachedDownloader)

    const processedMessages: ChannelEvent[] = []
    for (const e of messageEvents) {
      if (e.type === 'message_received') {
        const mediaId = msgToMediaId.get(e.messageId)
        if (mediaId && failedMediaIds.has(mediaId)) {
          processedMessages.push({
            ...e,
            metadata: { ...e.metadata, mediaDownloadFailed: true, failedMediaId: mediaId },
          })
          continue
        }
      }
      processedMessages.push(e)
    }

    const dedupedMessages = processedMessages.filter(
      (e) => e.type !== 'message_received' || !isRecentlySent(e.messageId),
    )

    const statusEvents = parseWhatsAppStatuses(payload)

    const dedupedStatuses = statusEvents.filter((e) => {
      if (e.type !== 'status_update') return true
      return !isStatusDuplicate(e.messageId, e.status)
    })

    const orderedStatuses = dedupedStatuses.filter((e) => {
      if (e.type !== 'status_update') return true
      const current = getHighWater(e.messageId)
      if (shouldUpdateStatus(current, e.status)) {
        setHighWater(e.messageId, e.status)
        return true
      }
      console.warn('[whatsapp] Status out-of-order filtered', {
        messageId: e.messageId,
        current,
        incoming: e.status,
      })
      return false
    })

    const templateStatusEvents: ChannelEvent[] = []
    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        if (change.field !== 'message_template_status_update') continue
        const v = change.value as unknown as Record<string, unknown>
        const event = v.event as string | undefined
        const templateName = v.message_template_name as string | undefined
        const templateId = v.message_template_id as number | string | undefined
        if (!event || !templateName) continue
        const mappedStatus: StatusUpdateEvent['status'] =
          event === 'REJECTED' || event === 'PAUSED' ? 'failed' : 'delivered'
        templateStatusEvents.push({
          type: 'status_update',
          channel: 'whatsapp',
          messageId: String(templateId ?? templateName),
          status: mappedStatus,
          timestamp: Date.now(),
          metadata: {
            templateStatusUpdate: true,
            templateName,
            templateStatus: event,
          },
        } satisfies StatusUpdateEvent)
      }
    }

    return [...dedupedMessages, ...orderedStatuses, ...templateStatusEvents]
  }

  // ─── Send ──────────────────────────────────────────────────────

  async function send(message: OutboundMessage): Promise<SendResult> {
    try {
      if (message.template) {
        return await sendTemplate(message)
      }
      if (message.metadata?.interactive) {
        return await sendInteractive(message)
      }
      if (message.media?.length) {
        return await sendMedia(message)
      }
      if (message.text !== undefined && message.text !== null) {
        if (message.text.length === 0) {
          return {
            success: false,
            error: 'Cannot send empty text message',
            retryable: false,
          }
        }
        return await sendText(message)
      }
      return { success: false, error: 'No content to send', retryable: false }
    } catch (err) {
      return errorToSendResult(err)
    }
  }

  async function sendText(message: OutboundMessage): Promise<SendResult> {
    const chunks = chunkText(message.text ?? '')
    let lastMessageId: string | undefined

    for (const chunk of chunks) {
      const payload: Record<string, unknown> = {
        messaging_product: 'whatsapp',
        to: message.to,
        type: 'text',
        text: { body: chunk, preview_url: /https?:\/\//.test(chunk) },
      }

      if (message.metadata?.replyToMessageId) {
        payload.context = { message_id: message.metadata.replyToMessageId }
      }

      const data = await graphFetch(`/${phoneNumberId}/messages`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })

      lastMessageId = data.messages?.[0]?.id
      if (lastMessageId) addRecentlySent(lastMessageId)
    }

    return { success: true, messageId: lastMessageId }
  }

  async function sendTemplate(message: OutboundMessage): Promise<SendResult> {
    const tmpl = message.template ?? { name: '', language: 'en' }
    const components = tmpl.components?.length
      ? tmpl.components
      : tmpl.parameters?.length
        ? [
            {
              type: 'body',
              parameters: tmpl.parameters.map((p) => ({
                type: 'text',
                text: p,
              })),
            },
          ]
        : undefined

    const payload = {
      messaging_product: 'whatsapp',
      to: message.to,
      type: 'template',
      template: {
        name: tmpl.name,
        language: { code: tmpl.language },
        components,
      },
    }

    const data = await graphFetch(`/${phoneNumberId}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })

    const messageId = data.messages?.[0]?.id
    if (messageId) addRecentlySent(messageId)
    return { success: true, messageId }
  }

  async function sendInteractive(message: OutboundMessage): Promise<SendResult> {
    const payload = {
      messaging_product: 'whatsapp',
      to: message.to,
      type: 'interactive',
      interactive: message.metadata?.interactive,
    }

    const data = await graphFetch(`/${phoneNumberId}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })

    const messageId = data.messages?.[0]?.id
    if (messageId) addRecentlySent(messageId)
    return { success: true, messageId }
  }

  async function sendMedia(message: OutboundMessage): Promise<SendResult> {
    if (!message.media?.length) {
      return {
        success: false,
        error: 'No media item provided',
        retryable: false,
      }
    }

    let lastMessageId: string | undefined

    for (const item of message.media) {
      const mediaType = item.type
      const mediaPayload: Record<string, unknown> = {}

      if (item.url) {
        mediaPayload.link = item.url
      } else if (item.data) {
        const maxSize = MEDIA_SIZE_LIMITS[mediaType] ?? DEFAULT_MEDIA_SIZE_LIMIT
        if (item.data.length > maxSize) {
          return {
            success: false,
            error: `Media size ${item.data.length} exceeds ${mediaType} limit of ${maxSize} bytes`,
            retryable: false,
          }
        }
        const form = new FormData()
        form.append('messaging_product', 'whatsapp')
        form.append('type', item.mimeType ?? 'application/octet-stream')
        form.append(
          'file',
          new Blob([new Uint8Array(item.data)], {
            type: item.mimeType ?? 'application/octet-stream',
          }),
          item.filename ?? 'file',
        )

        const uploadRes = await transportFetch(`/${phoneNumberId}/media`, {
          method: 'POST',
          body: form,
        })
        if (!uploadRes.ok) {
          const body = await uploadRes.text()
          throw new Error(`Media upload failed: ${body}`)
        }
        const uploadData = (await uploadRes.json()) as { id: string }
        mediaPayload.id = uploadData.id
      } else {
        return {
          success: false,
          error: 'Media item has neither url nor data',
          retryable: false,
        }
      }

      if (item.caption) {
        mediaPayload.caption = item.caption
      }
      if (item.filename) {
        mediaPayload.filename = item.filename
      }

      const payload: Record<string, unknown> = {
        messaging_product: 'whatsapp',
        to: message.to,
        type: mediaType,
        [mediaType]: mediaPayload,
      }

      if (message.metadata?.replyToMessageId) {
        payload.context = { message_id: message.metadata.replyToMessageId }
      }

      const data = await graphFetch(`/${phoneNumberId}/messages`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })

      lastMessageId = data.messages?.[0]?.id
      if (lastMessageId) addRecentlySent(lastMessageId)
    }

    return { success: true, messageId: lastMessageId }
  }

  // ─── Capabilities ──────────────────────────────────────────────

  const capabilities: ChannelCapabilities = {
    templates: true,
    media: true,
    reactions: true,
    readReceipts: true,
    typingIndicators: false,
    streaming: false,
    messagingWindow: true,
    nativeThreading: false,
  }

  return {
    name: 'whatsapp',
    inboundMode: 'push',
    contactIdentifierField: 'phone',
    capabilities,
    verifyWebhook,
    parseWebhook,
    handleWebhookChallenge,
    send,
    ...managementOps,
    ...templateOps,
    extractInstanceIdentifier(payload: unknown): string | null {
      try {
        const p = payload as WhatsAppWebhookPayload
        return p?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id ?? null
      } catch {
        return null
      }
    },
  }
}

// Re-export for testing
export { chunkText as _chunkText } from './api'
export { ERROR_CODE_MAP as _ERROR_CODE_MAP } from './types'
