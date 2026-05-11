import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import { zValidator } from '@hono/zod-validator'
import { getOrgSetting, type OrgSettingKey, setOrgSetting } from '@modules/settings/service/org-settings'
import { Hono } from 'hono'
import { z } from 'zod'

const ORG_SETTING_KEYS: OrgSettingKey[] = ['defaultOperatorAgentId']

const setSchema = z.object({ value: z.string().nullable() })

const invalidBody = (
  result: { success: boolean; error?: { issues: unknown } },
  c: { json: (b: unknown, s: number) => Response },
) => (result.success ? undefined : c.json({ error: 'invalid_body', issues: result.error?.issues }, 400))

const app = new Hono<OrganizationEnv>()
  .use('*', requireOrganization)
  .get('/:key', async (c) => {
    const key = c.req.param('key') as OrgSettingKey
    if (!ORG_SETTING_KEYS.includes(key)) return c.json({ error: 'unknown_key' }, 400)
    const organizationId = c.get('organizationId')
    const value = await getOrgSetting(organizationId, key)
    return c.json({ key, value })
  })
  .put('/:key', zValidator('json', setSchema, invalidBody), async (c) => {
    const key = c.req.param('key') as OrgSettingKey
    if (!ORG_SETTING_KEYS.includes(key)) return c.json({ error: 'unknown_key' }, 400)
    const organizationId = c.get('organizationId')
    const { value } = c.req.valid('json')
    await setOrgSetting(organizationId, key, value)
    return c.json({ key, value })
  })

export default app
