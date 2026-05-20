/**
 * Registry-driven inbound webhook router for platform-managed channels
 * (per §4.4 + §6 of the slices roadmap).
 *
 * Mount path: `/api/channels/managed/inbound/:channelInstanceId`
 *
 * Flow per inbound:
 *   1. HMAC-verify the payload via the v2 transport (`verifyInboundManagedWebhook`).
 *   2. Resolve the channel-instance row → look up its `kind` in the managed
 *      registry (`findByChannelName`).
 *   3. Dispatch on `registry.inboundDispatch`:
 *        - `'staff_reply'` → notification-tier branch (ask-staff-answer or
 *           operator-thread fallback).
 *        - `'customer'`    → reserved; today the customer-WA webhook router
 *           owns customer inbound, so this branch 410s with a clear hint.
 *
 * Verification + parsing live in this file. Branch bodies live in
 * `staff-reply-dispatch.ts` so the router stays small and a new kind
 * (e.g. SMS-notification) plugs in via a new branch helper without growing
 * this router.
 */

import { timingSafeEqual } from 'node:crypto'
import {
  sha256Hex,
  splitPathAndQuery,
  verifyInboundManagedWebhook,
} from '@modules/channels/adapters/whatsapp/managed-transport'
import { findByChannelName } from '@modules/channels/managed/registry'
import { channelInstances } from '@modules/channels/schema'
import { getInstalledDb, getVaultFor } from '@modules/integrations/service/registry'
import { deriveVerifyToken } from '@modules/integrations/service/verify-token'
import { errorHandler, notFound, unauthorized } from '@vobase/core'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'

import { dispatchStaffReply, type MetaInbound } from './staff-reply-dispatch'

const app = new Hono()
  .onError(errorHandler)
  /**
   * Meta-style hub challenge. The platform's webhook self-registration
   * appends `hub.mode=subscribe&hub.verify_token=<expected>&hub.challenge=<r>`.
   * Verify token is HKDF-derived from BETTER_AUTH_SECRET so the platform's
   * registration value and the tenant's compare always agree.
   */
  .get('/inbound/:channelInstanceId', async (c) => {
    const mode = c.req.query('hub.mode')
    const token = c.req.query('hub.verify_token')
    const challenge = c.req.query('hub.challenge')
    if (mode !== 'subscribe' || !token || !challenge) return c.text('Invalid verification request', 400)

    const db = getInstalledDb()
    const [instance] = await db
      .select({ channel: channelInstances.channel, config: channelInstances.config, status: channelInstances.status })
      .from(channelInstances)
      .where(eq(channelInstances.id, c.req.param('channelInstanceId')))
      .limit(1)
    if (!instance || instance.status !== 'active') return c.text('Forbidden', 403)
    const entry = findByChannelName(instance.channel)
    if (!entry) return c.text('Forbidden', 403)

    const tenantSlug = process.env.VITE_PLATFORM_TENANT_SLUG ?? ''
    const betterAuthSecret = process.env.BETTER_AUTH_SECRET ?? ''
    if (!tenantSlug || !betterAuthSecret) return c.text('Forbidden', 403)
    const environment = (instance.config.environment as 'production' | 'staging' | undefined) ?? 'production'
    const expected = deriveVerifyToken({
      tenantSlug,
      environment,
      provider: entry.channelName,
      betterAuthSecret,
    })
    const a = Buffer.from(token)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return c.text('Forbidden', 403)
    return c.text(challenge)
  })
  .post('/inbound/:channelInstanceId', async (c) => {
    const channelInstanceId = c.req.param('channelInstanceId')
    const rawBody = await c.req.text()

    // ─── Headers ─────────────────────────────────────────────────────────────
    const routineSig = c.req.header('x-vobase-routine-sig')
    const rotationSig = c.req.header('x-vobase-rotation-sig')
    const keyVersionRaw = c.req.header('x-vobase-key-version')
    if (!routineSig || !rotationSig || !keyVersionRaw) throw unauthorized('missing_sig')
    const keyVersion = Number.parseInt(keyVersionRaw, 10)
    if (!Number.isFinite(keyVersion)) throw unauthorized('bad_key_version')

    // ─── Channel instance + registry lookup ──────────────────────────────────
    const db = getInstalledDb()
    const [instance] = await db
      .select({
        id: channelInstances.id,
        channel: channelInstances.channel,
        organizationId: channelInstances.organizationId,
        config: channelInstances.config,
        status: channelInstances.status,
      })
      .from(channelInstances)
      .where(eq(channelInstances.id, channelInstanceId))
      .limit(1)
    if (!instance || instance.status !== 'active') throw notFound('channel instance')
    const entry = findByChannelName(instance.channel)
    if (!entry) throw notFound(`channel kind for ${instance.channel}`)

    // ─── HMAC v2 verify ──────────────────────────────────────────────────────
    const vault = getVaultFor(instance.organizationId)
    const rotation = await vault.readSecret(entry.vaultProvider)
    if (!rotation) return c.json({ error: 'no_vault_secret' }, 500)
    const url = new URL(c.req.url)
    const { pathOnly, sortedQuery } = splitPathAndQuery(url.pathname + url.search)
    const v2Payload = `POST|${pathOnly}|${sortedQuery}|${sha256Hex(rawBody)}`
    const verifyResult = verifyInboundManagedWebhook({
      signedPayload: v2Payload,
      routineSignature: routineSig,
      rotationSignature: rotationSig,
      keyVersion,
      current: rotation.current,
      previous: rotation.previous,
    })
    if (!verifyResult.ok) throw unauthorized(`invalid_sig: ${verifyResult.reason}`)

    // ─── Parse + dispatch on registry kind ───────────────────────────────────
    let payload: MetaInbound
    try {
      payload = JSON.parse(rawBody) as MetaInbound
    } catch {
      return c.json({ ok: true, branch: 'unparseable_body' })
    }
    switch (entry.inboundDispatch) {
      case 'staff_reply': {
        const result = await dispatchStaffReply({ db, organizationId: instance.organizationId, payload })
        return c.json(result)
      }
      case 'customer':
        // Reserved — sandbox-tier inbound today routes via the customer-WA
        // webhook router (`handlers/webhook.ts`). Return a clear hint rather
        // than silently dropping the payload.
        return c.json({ error: 'wrong_router', detail: 'inboundDispatch=customer' }, 410)
      default: {
        // Exhaustive check — if a future `InboundDispatch` variant lands, this
        // line stops compiling until the new case is handled above.
        const _exhaustive: never = entry.inboundDispatch
        return c.json({ error: 'wrong_router', detail: `inboundDispatch=${_exhaustive as string}` }, 410)
      }
    }
  })

export default app
