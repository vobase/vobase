import type { AgentEvent } from '@server/contracts/event'
import type { AgentObserver, ObserverContext } from '@server/contracts/observer'
import { recordCostUsage } from '../service/cost'

export function createCostAggregatorObserver(): AgentObserver {
  return {
    id: 'agents:cost-aggregator',

    async handle(event: AgentEvent, ctx: ObserverContext): Promise<void> {
      if (event.type !== 'llm_call') return
      if (event.costUsd <= 0) return

      const today = new Date().toISOString().slice(0, 10)
      await recordCostUsage({
        tenantId: event.tenantId,
        date: today,
        llmTask: event.task,
        tokensIn: event.tokensIn,
        tokensOut: event.tokensOut,
        cacheReadTokens: event.cacheReadTokens,
        costUsd: event.costUsd,
      }).catch((err) => ctx.logger.warn({ err }, 'cost-aggregator: failed to record cost usage'))
    },
  }
}
