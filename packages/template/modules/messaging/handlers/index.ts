import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import { zValidator } from '@hono/zod-validator'
import type { MessageAttachmentRef } from '@modules/drive/service/types'
import type { Message } from '@modules/messaging/schema'
import {
  get as getConversation,
  listActivity,
  list as listConversations,
  listMessagingByContact,
} from '@modules/messaging/service/conversations'
import { getDriveFilesByIds } from '@modules/messaging/service/drive-attachments'
import { list as listMessages } from '@modules/messaging/service/messages'
import { list as listApprovals } from '@modules/messaging/service/pending-approvals'
import { Hono } from 'hono'
import { z } from 'zod'

import approvals from './approvals'
import notes from './notes'
import reassign from './reassign'
import reply from './reply'
import resolve from './resolve'
import snooze from './snooze'
import typing from './typing'

/**
 * Pre-feature outbound `send_file` rows persist `content.driveFileId` with no
 * `content.type` and an empty `attachments[]`, so the inbox renderer has no
 * mime to pick `<video>` vs `<img>`. Batch-load `drive_files` for those rows
 * and synthesize an attachment ref so legacy media renders correctly without
 * a backfill migration. Skip rows that already have attachments or that
 * carry an explicit `content.type` — new rows write both.
 */
async function enrichLegacyMediaRows(organizationId: string, rows: Message[]): Promise<Message[]> {
  const driveFileIds = new Set<string>()
  for (const row of rows) {
    if (row.kind !== 'image') continue
    if (row.attachments && row.attachments.length > 0) continue
    const content = row.content as { driveFileId?: string; type?: string } | null
    if (!content?.driveFileId || content.type) continue
    driveFileIds.add(content.driveFileId)
  }
  if (driveFileIds.size === 0) return rows
  const files = await getDriveFilesByIds(organizationId, [...driveFileIds])
  return rows.map((row) => {
    if (row.kind !== 'image' || (row.attachments && row.attachments.length > 0)) return row
    const content = row.content as { driveFileId?: string; type?: string; caption?: string | null } | null
    if (!content?.driveFileId || content.type) return row
    const file = files.get(content.driveFileId)
    if (!file) return row
    const synthesized: MessageAttachmentRef = {
      driveFileId: file.id,
      path: file.path,
      mimeType: file.mimeType ?? 'application/octet-stream',
      sizeBytes: file.sizeBytes ?? 0,
      name: file.path.split('/').pop() ?? file.id,
      caption: content.caption ?? file.caption ?? null,
      extractionKind: file.extractionKind,
    }
    return { ...row, attachments: [synthesized] }
  })
}

const app = new Hono<OrganizationEnv>()
  .use('*', requireOrganization)
  .get('/health', (c) => c.json({ module: 'messaging', status: 'ok' }))
  .get('/conversations', async (c) => {
    const organizationId = c.get('organizationId')
    const status = c.req.query('status')?.split(',').filter(Boolean)
    const tabRaw = c.req.query('tab')
    const tab = tabRaw === 'active' || tabRaw === 'later' || tabRaw === 'done' ? tabRaw : undefined
    const owner = c.req.query('owner') || undefined
    const contactId = c.req.query('contactId') || undefined
    const grouped = c.req.query('grouped') === '1'
    if (grouped) {
      const result = await listMessagingByContact(organizationId, {
        status: status?.length ? status : undefined,
        owner,
      })
      return c.json(result)
    }
    const rows = await listConversations(organizationId, {
      status: status?.length ? status : undefined,
      tab,
      owner,
      contactId,
    })
    return c.json(rows)
  })
  .get('/conversations/:id', async (c) => {
    try {
      const row = await getConversation(c.req.param('id'))
      return c.json(row)
    } catch {
      return c.json({ error: 'not_found' }, 404)
    }
  })
  .get('/conversations/:id/messages', zValidator('query', z.object({ limit: z.string().optional() })), async (c) => {
    const id = c.req.param('id')
    const limit = Number(c.req.valid('query').limit ?? 50)
    const rows = await listMessages(id, { limit })
    return c.json(await enrichLegacyMediaRows(c.get('organizationId'), rows))
  })
  .get('/conversations/:id/activity', async (c) => {
    const rows = await listActivity(c.req.param('id'))
    return c.json(rows)
  })
  .get('/approvals', async (c) => {
    const status = c.req.query('status') ?? 'pending'
    const rows = await listApprovals(c.get('organizationId'), { status })
    return c.json(rows)
  })
  .route('/approvals', approvals)
  .route('/conversations', notes)
  .route('/conversations', reassign)
  .route('/conversations', reply)
  .route('/conversations', snooze)
  .route('/conversations', resolve)
  .route('/conversations', typing)

export default app
