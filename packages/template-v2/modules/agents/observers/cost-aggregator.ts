import type { AgentEvent } from '@server/contracts/event'
import type { AgentObserver } from '@server/contracts/observer'
import { getLogger } from '@server/services'
import { recordCostUsage } from '../service/cost'

export function createCostAggregatorObserver(): AgentObserver {
  return {
    id: 'agents:cost-aggregator',

    async handle(event: AgentEvent): Promise<void> {
      if (event.type !== 'llm_call') return
      if (event.costUsd <= 0) return

      const today = new Date().toISOString().slice(0, 10)
      await recordCostUsage({
        organizationId: event.organizationId,
        date: today,
        llmTask: event.task,
        tokensIn: event.tokensIn,
        tokensOut: event.tokensOut,
        cacheReadTokens: event.cacheReadTokens,
        costUsd: event.costUsd,
      }).catch((err) => getLogger().warn({ err }, 'cost-aggregator: failed to record cost usage'))
    },
  }
}
