/**
 * Generic webhook ingress for inbound channel events.
 *
 * Routes:
 *   - GET  /webhooks/:channel/:instanceId — adapter's webhook challenge handshake
 *   - POST /webhooks/:channel/:instanceId — adapter's verifyWebhook + parseWebhook
 *
 * Resolves the `channel_instances` row, looks up the adapter via the registry,
 * and delegates to the contract methods. Per-channel auth/secret edge cases
 * stay inside the adapter; this router is dumb routing + error shaping.
 */

import { dispatchInbound } from '@modules/channels/service/inbound'
import { getInstance } from '@modules/channels/service/instances'
import { get as registryGet } from '@modules/channels/service/registry'
import { Hono } from 'hono'

const app = new Hono()
  .get('/:channel/:instanceId', async (c) => {
    const { channel, instanceId } = c.req.param()
    const instance = await getInstance(instanceId)
    if (!instance || instance.channel !== channel) return c.json({ error: 'not_found' }, 404)
    const adapter = registryGet(channel, instance.config, instance.id)
    if (!adapter?.handleWebhookChallenge) return c.json({ error: 'unsupported' }, 400)
    const res = adapter.handleWebhookChallenge(c.req.raw)
    return res ?? c.json({ error: 'challenge_failed' }, 403)
  })
  .post('/:channel/:instanceId', async (c) => {
    const { channel, instanceId } = c.req.param()
    const instance = await getInstance(instanceId)
    if (!instance || instance.channel !== channel) return c.json({ error: 'not_found' }, 404)

    const adapter = registryGet(channel, instance.config, instance.id)
    if (!adapter) return c.json({ error: 'no_adapter' }, 400)

    if (adapter.verifyWebhook) {
      const ok = await adapter.verifyWebhook(c.req.raw)
      if (!ok) return c.json({ error: 'unauthorized' }, 401)
    }

    if (!adapter.parseWebhook) return c.json({ error: 'unsupported' }, 400)
    const events = await adapter.parseWebhook(c.req.raw)
    const results = await dispatchInbound(events, instance)
    return c.json({ received: true, processed: results.length, results })
  })

export default app
