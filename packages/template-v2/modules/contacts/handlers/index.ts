import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import { zValidator } from '@hono/zod-validator'
import { recordChange } from '@modules/changes/service/proposals'
import {
  create as createContact,
  get as getContact,
  list as listContacts,
  update as updateContact,
} from '@modules/contacts/service/contacts'
import type { ChangePayload } from '@vobase/core'
import { Hono } from 'hono'
import { z } from 'zod'

import type { Contact } from '../schema'
import { CONTACT_RESOURCE } from '../service/changes'
import attributeHandlers from './attributes'

const createContactBody = z.object({
  displayName: z.string().trim().min(1).max(200).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  phone: z.string().trim().min(1).max(40).nullable().optional(),
  segments: z.array(z.string().min(1)).optional(),
  marketingOptOut: z.boolean().optional(),
})

const updateContactBody = createContactBody

const TRACKED_FIELDS = ['displayName', 'email', 'phone', 'segments', 'marketingOptOut'] as const

const app = new Hono<OrganizationEnv>()
  .use('*', requireOrganization)
  .get('/health', (c) => c.json({ module: 'contacts', status: 'ok' }))
  .route('/', attributeHandlers)
  .get('/', async (c) => {
    const rows = await listContacts(c.get('organizationId'))
    return c.json(rows)
  })
  .post(
    '/',
    zValidator('json', createContactBody, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
      }
    }),
    async (c) => {
      const data = c.req.valid('json')
      const row = await createContact({ organizationId: c.get('organizationId'), ...data })
      const payload = buildFieldSetPayload(null, row, data)
      if (payload) {
        await safeRecordChange({
          organizationId: c.get('organizationId'),
          resourceModule: CONTACT_RESOURCE.module,
          resourceType: CONTACT_RESOURCE.type,
          resourceId: row.id,
          payload,
          before: null,
          after: row,
          changedBy: c.get('session').user.id,
          changedByKind: 'user',
        })
      }
      return c.json(row)
    },
  )
  .get('/:id', async (c) => {
    try {
      const row = await getContact(c.req.param('id'))
      return c.json(row)
    } catch {
      return c.json({ error: 'not_found' }, 404)
    }
  })
  .patch(
    '/:id',
    zValidator('json', updateContactBody, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
      }
    }),
    async (c) => {
      const data = c.req.valid('json')
      const id = c.req.param('id')
      let before: Contact
      try {
        before = await getContact(id)
      } catch {
        return c.json({ error: 'not_found' }, 404)
      }
      const after = await updateContact(id, data)
      const payload = buildFieldSetPayload(before, after, data)
      if (payload) {
        await safeRecordChange({
          organizationId: c.get('organizationId'),
          resourceModule: CONTACT_RESOURCE.module,
          resourceType: CONTACT_RESOURCE.type,
          resourceId: id,
          payload,
          before,
          after,
          changedBy: c.get('session').user.id,
          changedByKind: 'user',
        })
      }
      return c.json(after)
    },
  )

export default app

/** Diff tracked fields between `before` (null on create) and `after`. Returns
 *  null when no tracked field actually changed so the caller can skip the audit
 *  write. */
function buildFieldSetPayload(
  before: Contact | null,
  after: Contact,
  data: z.infer<typeof createContactBody>,
): ChangePayload | null {
  const fields: Record<string, { from: unknown; to: unknown }> = {}
  for (const key of TRACKED_FIELDS) {
    if (data[key] === undefined) continue
    const fromValue = before ? before[key as keyof Contact] : null
    const toValue = after[key as keyof Contact]
    if (before && structuralEqual(fromValue, toValue)) continue
    fields[key] = { from: fromValue, to: toValue }
  }
  return Object.keys(fields).length === 0 ? null : { kind: 'field_set', fields }
}

function structuralEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b)
  return false
}

/** Audit-write is non-atomic with the contact mutation (singleton service has
 *  no tx hook). Swallow audit failures so a transient changes-service hiccup
 *  doesn't surface a 500 for an otherwise-successful contact write. */
async function safeRecordChange(input: Parameters<typeof recordChange>[0]): Promise<void> {
  try {
    await recordChange(input)
  } catch (err) {
    console.error('[contacts] recordChange failed (audit gap):', err instanceof Error ? err.message : err)
  }
}
