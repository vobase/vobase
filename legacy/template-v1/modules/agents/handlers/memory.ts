import { getCtx, unauthorized, validation } from '@vobase/core'
import { Hono } from 'hono'

import { getMemory } from '../mastra/index'
import { scopeSchema } from './_shared'

export const memoryHandlers = new Hono()
  /** GET /memory/working?scope=contact:ID — Get Mastra working memory for a contact */
  .get('/memory/working', async (c) => {
    const { user } = getCtx(c)
    if (!user) throw unauthorized()

    const rawScope = c.req.query('scope')
    if (!rawScope) throw validation({ scope: 'Required. Format: contact:ID or user:ID' })

    const parsed = scopeSchema.safeParse(rawScope)
    if (!parsed.success) throw validation({ scope: parsed.error.message })

    const resourceId = rawScope // e.g. "contact:abc123"

    try {
      const memory = getMemory()

      // Working memory is stored per resource (e.g. "contact:abc123")
      const wm = await memory.getWorkingMemory({ threadId: '', resourceId }).catch(() => null)

      return c.json({
        workingMemory: wm,
        resourceId,
      })
    } catch {
      return c.json({ workingMemory: null, resourceId })
    }
  })
