import type { ApiKeySummary, CreatedApiKey } from '@auth/api-keys'
import type { SessionEnv } from '@auth/middleware/require-session'
import { zValidator } from '@hono/zod-validator'
import { createKey, listKeys, revokeKey } from '@modules/settings/service/api-keys'
import { Hono } from 'hono'
import { z } from 'zod'

const createSchema = z.object({ name: z.string().min(1) })

const invalidBody = (
  result: { success: boolean; error?: { issues: unknown } },
  c: { json: (b: unknown, s: number) => Response },
) => (result.success ? undefined : c.json({ error: 'invalid_body', issues: result.error?.issues }, 400))

export interface ApiKeySummaryDto {
  id: string
  name: string | null
  prefix: string
  start: string | null
  enabled: boolean
  lastRequest: string | null
  createdAt: string
}

export interface CreatedApiKeyDto extends ApiKeySummaryDto {
  key: string
}

function toSummaryDto(row: ApiKeySummary): ApiKeySummaryDto {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    start: row.start,
    enabled: row.enabled,
    lastRequest: row.lastRequest ? row.lastRequest.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }
}

function toCreatedDto(row: CreatedApiKey): CreatedApiKeyDto {
  return { ...toSummaryDto(row), key: row.key }
}

const app = new Hono<SessionEnv>()
  .get('/api-keys', async (c) => {
    const userId = c.get('session').user.id
    const rows = await listKeys(userId)
    return c.json(rows.map(toSummaryDto))
  })
  .post('/api-keys', zValidator('json', createSchema, invalidBody), async (c) => {
    const userId = c.get('session').user.id
    const { name } = c.req.valid('json')
    const created = await createKey(userId, name)
    return c.json(toCreatedDto(created))
  })
  .delete('/api-keys/:id', async (c) => {
    const userId = c.get('session').user.id
    const ok = await revokeKey(userId, c.req.param('id'))
    if (!ok) return c.json({ error: 'not_found' }, 404)
    return c.json({ ok: true })
  })

export default app
