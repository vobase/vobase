/**
 * auditObserver — writes one _audit.auditLog row + one agents.auditWakeMap row per event.
 * Per-wake scoping via auditWakeMap.wakeId (B3). Does not modify core's auditLog schema (R6).
 *
 * R6: imports auditLog from @vobase/core — does NOT re-declare it.
 * Spec §12.1 #1.
 *
 * Phase 2 (plan §P2.0, A1d): audit_wake_map rows cover `channel_inbound`,
 * `channel_outbound`, `wake_scheduled`.
 * Phase 3 (plan §P3.0): audit_wake_map also covers the two new variants —
 * `moderation_blocked` and `scorer_recorded` — via the same generic handle()
 * (the switch-free fanout reads `event.type` at runtime, so new AgentEvent
 * variants are audited automatically without a code change).
 */

import type { AgentEvent } from '@server/contracts/event'
import type { AgentObserver, ObserverContext } from '@server/contracts/observer'
import { auditLog } from '@vobase/core'

export const auditObserver: AgentObserver = {
  id: 'agents:audit',

  async handle(event: AgentEvent, ctx: ObserverContext): Promise<void> {
    const { auditWakeMap } = await import('@modules/agents/schema')

    const details = JSON.stringify({
      conversationId: ctx.conversationId,
      wakeId: ctx.wakeId,
      tenantId: ctx.tenantId,
      type: event.type,
      turnIndex: event.turnIndex,
      ...(event as unknown as Record<string, unknown>),
    })

    // Insert into core's auditLog; use .returning() to capture the generated id
    const auditRows = await ctx.db
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

    // Insert satellite row for per-wake scoping (B3)
    await ctx.db.insert(auditWakeMap).values({
      auditLogId,
      wakeId: ctx.wakeId,
      conversationId: ctx.conversationId,
      eventType: event.type,
      tenantId: ctx.tenantId,
    })
  },
}
