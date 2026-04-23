/**
 * auditObserver — writes one _audit.auditLog row + one agents.auditWakeMap row per event.
 * Per-wake scoping via auditWakeMap.wakeId (B3). Does not modify core's auditLog schema (R6).
 *
 * R6: imports auditLog from @vobase/core — does NOT re-declare it.
 *
 * Phase 2: audit_wake_map rows cover `channel_inbound`,
 * `channel_outbound`, `wake_scheduled`.
 * Phase 3: audit_wake_map also covers the two new variants —
 * `moderation_blocked` and `scorer_recorded` — via the same generic handle()
 * (the switch-free fanout reads `event.type` at runtime, so new AgentEvent
 * variants are audited automatically without a code change).
 */

import type { AgentEvent } from '@server/contracts/event'
import type { AgentObserver } from '@server/contracts/observer'
import { getDb } from '@server/services'
import { auditLog } from '@vobase/core'

export const auditObserver: AgentObserver = {
  id: 'agents:audit',

  async handle(event: AgentEvent): Promise<void> {
    const { auditWakeMap } = await import('@modules/agents/schema')

    const details = JSON.stringify({
      conversationId: event.conversationId,
      wakeId: event.wakeId,
      organizationId: event.organizationId,
      type: event.type,
      turnIndex: event.turnIndex,
      ...(event as unknown as Record<string, unknown>),
    })

    const db = getDb()

    const auditRows = await db
      .insert(auditLog)
      .values({
        event: event.type,
        actorId: null,
        actorEmail: null,
        ip: null,
        details,
      })
      .returning()

    const auditLogId = auditRows[0]?.id
    if (!auditLogId) return

    await db.insert(auditWakeMap).values({
      auditLogId,
      wakeId: event.wakeId,
      conversationId: event.conversationId,
      eventType: event.type,
      organizationId: event.organizationId,
    })
  },
}
