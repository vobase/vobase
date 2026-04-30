/**
 * Operator-facing schedules route — wraps the `schedules run` CLI verb on a
 * session-authenticated HTTP transport so smoke tests + the in-app right-rail
 * can fire a heartbeat without needing an API key. Mirrors the body of
 * `schedulesRunVerb` 1:1 (uses the same `getHeartbeatEmitter()` registry, the
 * same idempotency-bypass semantics).
 *
 *   POST /api/agents/schedules/:id/run  → fires one heartbeat right now
 */

import type { SessionEnv } from '@auth/middleware/require-session'
import { getHeartbeatEmitter } from '@modules/schedules/service/heartbeat-emitter'
import { schedules as schedulesSvc } from '@modules/schedules/service/schedules'
import { Hono } from 'hono'

const app = new Hono<SessionEnv>().post('/:id/run', async (c) => {
  const id = c.req.param('id')
  const row = await schedulesSvc.getById(id)
  if (!row) return c.json({ error: `schedule not found: ${id}`, errorCode: 'not_found' }, 404)
  const emitter = getHeartbeatEmitter()
  if (!emitter) return c.json({ error: 'heartbeat emitter not installed', errorCode: 'not_ready' }, 503)
  const intendedRunAt = new Date()
  try {
    await emitter({
      kind: 'heartbeat',
      scheduleId: row.id,
      agentId: row.agentId,
      organizationId: row.organizationId,
      intendedRunAt: intendedRunAt.toISOString(),
      cron: row.cron,
    })
    return c.json({
      ok: true,
      scheduleId: row.id,
      agentId: row.agentId,
      conversationId: `heartbeat-${row.id}`,
      intendedRunAt: intendedRunAt.toISOString(),
    })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err), errorCode: 'emit_failed' }, 500)
  }
})

export default app
