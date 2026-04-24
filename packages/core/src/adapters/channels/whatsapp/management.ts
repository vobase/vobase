import { logger } from '../../../logger'
import type { GraphApiResponse } from './api'
import type { WhatsAppChannelConfig } from './types'
import { WhatsAppApiError } from './types'

// ─── Management Operations Factory ───────────────────────────────────

export interface ManagementOperations {
  markAsRead(messageId: string): Promise<void>
  checkWebhookSubscription(): Promise<{ subscribed: boolean; callbackUrl?: string; error?: string }>
  healthCheck(): Promise<{ ok: boolean; error?: string }>
  tokenStatus(): { valid: boolean; expiresAt?: Date; daysRemaining?: number }
  getMessagingTier(): Promise<{ tier: string; qualityRating: string }>
  registerWebhook(callbackUrl: string, verifyToken: string): Promise<void>
  deregisterWebhook(): Promise<void>
}

export function createManagementOperations(
  config: WhatsAppChannelConfig,
  graphFetch: (path: string, options?: RequestInit) => Promise<GraphApiResponse>,
): ManagementOperations {
  const { phoneNumberId } = config
  const transport = config.transport

  async function markAsRead(messageId: string): Promise<void> {
    await graphFetch(`/${phoneNumberId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }),
    })
  }

  async function checkWebhookSubscription(): Promise<{
    subscribed: boolean
    callbackUrl?: string
    error?: string
  }> {
    if (transport) return { subscribed: true } // managed by platform
    if (!config.appId) {
      return { subscribed: true } // can't check without appId, assume ok
    }

    try {
      const data = await graphFetch(`/${config.appId}/subscriptions`)
      const subscriptions = data.data as
        | Array<{
            object: string
            callback_url: string
            active: boolean
            fields: Array<{ name: string; version: string }>
          }>
        | undefined

      const wabaSub = subscriptions?.find((s) => s.object === 'whatsapp_business_account')

      if (!wabaSub) {
        return {
          subscribed: false,
          error: 'Webhook not subscribed — no whatsapp_business_account subscription found on this app',
        }
      }

      if (!wabaSub.active) {
        return {
          subscribed: false,
          callbackUrl: wabaSub.callback_url,
          error: 'Webhook subscription exists but is not active',
        }
      }

      const hasMessages = wabaSub.fields?.some((f) => f.name === 'messages')
      if (!hasMessages) {
        return {
          subscribed: false,
          callbackUrl: wabaSub.callback_url,
          error: 'Webhook subscription is missing the "messages" field',
        }
      }

      return { subscribed: true, callbackUrl: wabaSub.callback_url }
    } catch (err) {
      logger.warn('[WhatsApp] Could not verify webhook subscription', {
        appId: config.appId,
        error: err instanceof Error ? err.message : err,
      })
      return {
        subscribed: true,
        error: `Could not verify webhook subscription: ${err instanceof Error ? err.message : 'Unknown error'}`,
      }
    }
  }

  async function healthCheck(): Promise<{ ok: boolean; error?: string }> {
    if (transport) return { ok: true } // managed by platform in transport mode

    const now = new Date()
    if (config.tokenExpiresAt) {
      const expiresAt = config.tokenExpiresAt
      if (expiresAt <= now) return { ok: false, error: 'Token expired' }
      const daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      if (daysRemaining <= 7) {
        return {
          ok: true,
          error: `Token expires in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`,
        }
      }
    } else {
      // No tokenExpiresAt: make a lightweight API call to verify token validity
      try {
        await graphFetch(`/${phoneNumberId}?fields=id`)
      } catch (err) {
        if (err instanceof WhatsAppApiError && err.code === 190) {
          return { ok: false, error: 'Invalid token' }
        }
        return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
      }
    }

    // Token is valid — now check webhook subscription
    const subCheck = await checkWebhookSubscription()
    if (!subCheck.subscribed) {
      return { ok: false, error: subCheck.error ?? 'Webhook not subscribed' }
    }
    if (subCheck.error) {
      return { ok: true, error: subCheck.error }
    }

    return { ok: true }
  }

  function tokenStatus(): { valid: boolean; expiresAt?: Date; daysRemaining?: number } {
    if (!config.tokenExpiresAt) return { valid: true }
    const now = new Date()
    const expiresAt = config.tokenExpiresAt
    const expired = expiresAt <= now
    const msRemaining = expiresAt.getTime() - now.getTime()
    const daysRemaining = expired ? 0 : Math.ceil(msRemaining / (1000 * 60 * 60 * 24))
    return { valid: !expired, expiresAt, daysRemaining }
  }

  async function getMessagingTier(): Promise<{ tier: string; qualityRating: string }> {
    const data = await graphFetch(`/${phoneNumberId}?fields=messaging_limit_tier,quality_rating`)
    return {
      tier: (data.messaging_limit_tier as string | undefined) ?? 'unknown',
      qualityRating: (data.quality_rating as string | undefined) ?? 'unknown',
    }
  }

  async function registerWebhook(callbackUrl: string, verifyToken: string): Promise<void> {
    if (!config.appId) {
      throw new Error('appId is required in WhatsAppChannelConfig to register webhooks')
    }
    await graphFetch(`/${config.appId}/subscriptions`, {
      method: 'POST',
      body: JSON.stringify({
        object: 'whatsapp_business_account',
        callback_url: callbackUrl,
        verify_token: verifyToken,
        fields: 'messages',
      }),
    })
  }

  async function deregisterWebhook(): Promise<void> {
    if (!config.appId) {
      throw new Error('appId is required in WhatsAppChannelConfig to deregister webhooks')
    }
    await graphFetch(`/${config.appId}/subscriptions?object=whatsapp_business_account`, { method: 'DELETE' })
  }

  return {
    markAsRead,
    checkWebhookSubscription,
    healthCheck,
    tokenStatus,
    getMessagingTier,
    registerWebhook,
    deregisterWebhook,
  }
}
