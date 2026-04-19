/**
 * AgentsPort implementation — binds service methods to the typed port contract.
 * REAL: getAgentDefinition, appendEvent.
 * Scaffold: all other methods throw not-implemented-in-phase-1.
 */
import type { AgentsPort } from '@server/contracts/agents-port'
import type { AgentDefinition } from '@server/contracts/domain-types'
import type { AgentEvent } from '@server/contracts/event'
import type { Tx } from '@server/contracts/inbox-port'
import { agentDefinitions, journal } from './service'
import { getDailySpend } from './service/cost'

export function createAgentsPort(): AgentsPort {
  return {
    async getAgentDefinition(id: string): Promise<AgentDefinition> {
      return agentDefinitions.getById(id)
    },

    async appendEvent(event: AgentEvent, tx?: Tx): Promise<void> {
      // appendEvent without full context — callers pass context through JournalAppendInput
      // This top-level port method requires callers to provide conversation context via the event payload
      const ev = event as unknown as Record<string, unknown>
      await journal.append(
        {
          conversationId: (ev.conversationId as string) ?? '',
          tenantId: (ev.tenantId as string) ?? '',
          wakeId: (ev.wakeId as string | undefined) ?? null,
          turnIndex: (ev.turnIndex as number) ?? 0,
          event,
        },
        tx,
      )
    },

    async checkDailyCeiling(tenantId: string, agentId: string) {
      const def = await agentDefinitions.getById(agentId)
      const ceilingUsd = Number(def.hardCostCeilingUsd ?? 0)
      if (ceilingUsd <= 0) return { exceeded: false, spentUsd: 0, ceilingUsd: 0 }
      const spentUsd = await getDailySpend(tenantId)
      return { exceeded: spentUsd >= ceilingUsd, spentUsd, ceilingUsd }
    },
  }
}
