/**
 * Generic webhook ingress for inbound channel events.
 *
 * Routes:
 *   - GET  /webhook/:channel/:instanceId — adapter's webhook challenge handshake
 *   - POST /webhook/:channel/:instanceId — adapter's verifyWebhook + parseWebhook
 *
 * Resolves the `channel_instances` row, looks up the adapter via the registry,
 * and delegates to the contract methods. Per-channel auth/secret edge cases
 * stay inside the adapter; this router is dumb routing + error shaping.
 */

import { interceptContactsSync } from '@modules/channels/handlers/contacts-sync'
import { interceptHistoryWebhook } from '@modules/channels/handlers/history-intercept'
import { dispatchInbound } from '@modules/channels/service/inbound'
import { getInstance, RELEASED_STATUS } from '@modules/channels/service/instances'
import { get as registryGet } from '@modules/channels/service/registry'
import { Hono } from 'hono'

/**
 * Released instances stay in the DB to preserve conversation FKs, but the
 * webhook ingress must behave as if they never existed — otherwise upstream
 * providers that haven't been unsubscribed yet keep delivering events that
 * land as live inbound. We return 404 (not 410) to match the not-found shape
 * already documented for this router; providers back off on 4xx either way.
 */
const app = new Hono()
  .get('/:channel/:instanceId', async (c) => {
    const { channel, instanceId } = c.req.param()
    const instance = await getInstance(instanceId)
    if (!instance || instance.channel !== channel || instance.status === RELEASED_STATUS) {
      return c.json({ error: 'not_found' }, 404)
    }
    const adapter = await registryGet(channel, instance.config, instance.id)
    if (!adapter?.handleWebhookChallenge) return c.json({ error: 'unsupported' }, 400)
    const res = adapter.handleWebhookChallenge(c.req.raw)
    return res ?? c.json({ error: 'challenge_failed' }, 403)
  })
  .post('/:channel/:instanceId', async (c) => {
    const { channel, instanceId } = c.req.param()
    const instance = await getInstance(instanceId)
    if (!instance || instance.channel !== channel || instance.status === RELEASED_STATUS) {
      return c.json({ error: 'not_found' }, 404)
    }

    const adapter = await registryGet(channel, instance.config, instance.id)
    if (!adapter) return c.json({ error: 'no_adapter' }, 400)

    if (adapter.verifyWebhook) {
      const ok = await adapter.verifyWebhook(c.req.raw)
      if (!ok) return c.json({ error: 'unauthorized' }, 401)
    }

    // Parse the JSON body once and share it with both coexistence intercepts —
    // each used to re-clone + re-parse the same (potentially multi-MB) payload.
    // A non-JSON body is never a coexistence webhook, so fall through to the
    // adapter on a parse failure.
    let parsedBody: unknown = null
    try {
      parsedBody = await c.req.raw.clone().json()
    } catch {
      parsedBody = null
    }

    // Coexistence intercepts, run on the SAME parsed body before the live
    // adapter path. Both run unconditionally (each guards its own `field`) so a
    // single webhook carrying BOTH a `history` change and an `smb_app_state_sync`
    // change — wire-legal, since one delivery can hold multiple `entry[].changes[]`
    // — is fully handled instead of the second intercept being skipped. History
    // staging + drain keeps the chunked history (and the media-asset follow-up)
    // off the live inbound path; the contacts sync upserts names onto contacts.
    let historyHandled = false
    let contactsHandled = false
    if (parsedBody !== null) {
      historyHandled = await interceptHistoryWebhook(instance, parsedBody)
      contactsHandled = await interceptContactsSync(instance, parsedBody)
    }
    if (historyHandled || contactsHandled) {
      return c.json({
        received: true,
        ...(historyHandled ? { history: true } : {}),
        ...(contactsHandled ? { contactsSync: true } : {}),
      })
    }

    if (!adapter.parseWebhook) return c.json({ error: 'unsupported' }, 400)
    const events = await adapter.parseWebhook(c.req.raw)
    const defaultAssignee = (instance.config as { defaultAssignee?: string | null }).defaultAssignee ?? null
    const results = await dispatchInbound(events, instance, { defaultAssignee })
    return c.json({ received: true, processed: results.length, results })
  })

export default app
