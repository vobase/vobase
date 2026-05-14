import { E164_RE } from '@auth/e164'
import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import { zValidator } from '@hono/zod-validator'
import {
  find as findStaff,
  get as getStaff,
  list as listStaff,
  remove as removeStaff,
  update as updateStaff,
  upsert as upsertStaff,
} from '@modules/team/service/staff'
import { syncStaffLinksEnqueue } from '@modules/team/service/staff-link-sync'
import { Hono } from 'hono'
import { z } from 'zod'

import type { StaffProfile } from '../schema'
import attributeHandlers from './attributes'
import descriptionHandlers from './descriptions'
import heartbeatHandlers from './heartbeat'
import mentionHandlers from './mentions'

/** Accept `+E164` only (digits, leading `+`, 8-16 chars total). Empty/null clears. */
const phoneNumberSchema = z.string().regex(E164_RE, 'phoneNumber must be E.164 with leading +')

const availability = z.enum(['active', 'busy', 'off', 'inactive'])

const upsertStaffBody = z.object({
  userId: z.string().min(1).max(64),
  displayName: z.string().trim().min(1).max(200).nullable().optional(),
  title: z.string().trim().max(200).nullable().optional(),
  sectors: z.array(z.string().min(1)).optional(),
  expertise: z.array(z.string().min(1)).optional(),
  languages: z.array(z.string().min(1)).optional(),
  capacity: z.number().int().min(0).max(1000).optional(),
  availability: availability.optional(),
  profile: z.string().max(4000).optional(),
  memory: z.string().max(8000).optional(),
  phoneNumber: phoneNumberSchema.nullable().optional(),
})

const updateStaffBody = z.object({
  displayName: z.string().trim().min(1).max(200).nullable().optional(),
  title: z.string().trim().max(200).nullable().optional(),
  sectors: z.array(z.string().min(1)).optional(),
  expertise: z.array(z.string().min(1)).optional(),
  languages: z.array(z.string().min(1)).optional(),
  capacity: z.number().int().min(0).max(1000).optional(),
  availability: availability.optional(),
  profile: z.string().max(4000).optional(),
  memory: z.string().max(8000).optional(),
  phoneNumber: phoneNumberSchema.nullable().optional(),
})

/**
 * Returns `true` when the inbound patch's `phoneNumber` differs from
 * the existing row's value — the trigger for enqueueing a staff-link sync.
 * A patch that omits the field, or sets it to the same value, returns
 * `false` so no work is enqueued.
 */
function phoneChangedAfterWrite(before: StaffProfile | null, patch: { phoneNumber?: string | null }): boolean {
  if (!('phoneNumber' in patch)) return false
  const next = patch.phoneNumber ?? null
  const prev = before?.phoneNumber ?? null
  return next !== prev
}

const app = new Hono<OrganizationEnv>()
  .use('*', requireOrganization)
  .get('/health', (c) => c.json({ module: 'team', status: 'ok' }))
  .route('/', attributeHandlers)
  .route('/', descriptionHandlers)
  .route('/', heartbeatHandlers)
  .route('/', mentionHandlers)
  .get('/staff', async (c) => {
    const rows = await listStaff(c.get('organizationId'))
    return c.json(rows)
  })
  .post(
    '/staff',
    zValidator('json', upsertStaffBody, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
      }
    }),
    async (c) => {
      const data = c.req.valid('json')
      const organizationId = c.get('organizationId')
      const before = await findStaff(data.userId)
      const row = await upsertStaff({ organizationId, ...data })
      // Fire-and-forget enqueue per §4.3 — the platform call happens in
      // the background via the `team:sync-staff-link` pg-boss job, with
      // singletonKey coalescing PATCH bursts (R9-E).
      if (phoneChangedAfterWrite(before, data)) {
        await syncStaffLinksEnqueue(organizationId)
      }
      return c.json(row)
    },
  )
  .get('/staff/:userId', async (c) => {
    try {
      const row = await getStaff(c.req.param('userId'))
      return c.json(row)
    } catch {
      return c.json({ error: 'not_found' }, 404)
    }
  })
  .patch(
    '/staff/:userId',
    zValidator('json', updateStaffBody, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
      }
    }),
    async (c) => {
      const data = c.req.valid('json')
      const userId = c.req.param('userId')
      const before = await findStaff(userId)
      try {
        const row = await updateStaff(userId, data)
        if (phoneChangedAfterWrite(before, data)) {
          // Enqueue the reconciler; the actual platform `staffLinks.upsert`
          // / `staffLinks.delete` call happens inside the pg-boss handler.
          // No inline `upsertStaffLinkOnPlatform` call here per US-024.
          await syncStaffLinksEnqueue(row.organizationId)
        }
        return c.json(row)
      } catch {
        return c.json({ error: 'not_found' }, 404)
      }
    },
  )
  .delete('/staff/:userId', async (c) => {
    const userId = c.req.param('userId')
    const before = await findStaff(userId)
    await removeStaff(userId)
    if (before?.phoneNumber) {
      // Removing the staff row deletes its tenant-side phone binding too;
      // the reconciler will translate that into a platform-side delete on
      // its next run.
      await syncStaffLinksEnqueue(before.organizationId)
    }
    return c.json({ ok: true, userId })
  })

export default app
