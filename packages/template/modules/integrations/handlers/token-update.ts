/**
 * `POST /api/integrations/vobase-platform/token/update` — platform-initiated
 * rotation of the tenant's `vobase-platform` HMAC pair. Verified via the
 * 2-key contract (`x-vobase-routine-sig` + `x-vobase-rotation-sig` +
 * `x-vobase-key-version`); monotonic `keyVersion` rejects downgrade.
 *
 * Public route (no `requireOrganization`) — auth is the HMAC signature
 * itself, not a session.
 */

import { verifyRequest } from '@vobase/core'
import { Hono } from 'hono'
import { z } from 'zod'

import { getVaultFor } from '../service/registry'

const ROTATION_GRACE_MS = 5 * 60 * 1000 // 5 minutes

const updateBody = z.object({
  organizationId: z.string().min(1),
  newRoutineSecret: z.string().min(16),
  newRotationKey: z.string().min(16),
  newKeyVersion: z.number().int().positive(),
})

const app = new Hono().post('/vobase-platform/token/update', async (c) => {
  const rawBody = await c.req.text()

  const routineSig = c.req.header('x-vobase-routine-sig') ?? ''
  const rotationSig = c.req.header('x-vobase-rotation-sig') ?? ''
  const keyVersionHeader = c.req.header('x-vobase-key-version') ?? ''
  const keyVersion = Number.parseInt(keyVersionHeader, 10)

  if (!routineSig || !rotationSig || !Number.isInteger(keyVersion)) {
    return c.json({ error: 'missing_signature_headers' }, 401)
  }

  let parsed: z.infer<typeof updateBody>
  try {
    parsed = updateBody.parse(JSON.parse(rawBody))
  } catch {
    return c.json({ error: 'invalid_body' }, 400)
  }

  const vault = getVaultFor(parsed.organizationId)
  const existing = await vault.readSecret('vobase-platform')
  if (!existing) {
    return c.json({ error: 'no_existing_secret' }, 404)
  }

  // Build the accept slate from current + (optional) previous so a
  // rotation-in-flight inbound is verifiable. The verify call enforces
  // monotonic keyVersion vs `maxKeyVersionSeen = current.keyVersion`.
  const accept = [
    {
      routineSecret: existing.current.routineSecret,
      rotationKey: existing.current.rotationKey,
      keyVersion: existing.current.keyVersion,
    },
  ]
  if (existing.previous) {
    accept.push({
      routineSecret: existing.previous.routineSecret,
      rotationKey: existing.previous.rotationKey,
      keyVersion: existing.previous.keyVersion,
    })
  }

  const verified = verifyRequest({
    body: rawBody,
    routineSignature: routineSig,
    rotationSignature: rotationSig,
    keyVersion,
    maxKeyVersionSeen: existing.current.keyVersion,
    accept,
  })

  if (!verified.ok) {
    return c.json({ error: 'signature_verification_failed', reason: verified.reason }, 401)
  }

  // Reject downgrade rotations at the vault layer too — the rotation must
  // strictly advance keyVersion past current.
  if (parsed.newKeyVersion <= existing.current.keyVersion) {
    return c.json({ error: 'rotation_not_monotonic' }, 409)
  }

  await vault.rotate(
    'vobase-platform',
    {
      routineSecret: parsed.newRoutineSecret,
      rotationKey: parsed.newRotationKey,
      keyVersion: parsed.newKeyVersion,
    },
    new Date(Date.now() + ROTATION_GRACE_MS),
  )

  return c.json({ rotated: true, keyVersion: parsed.newKeyVersion })
})

export default app
