/**
 * TanStack Query hooks for lead-routing rules CRUD.
 *
 * Rules live in `team.routing_rules` and are exposed via
 * `GET/POST/DELETE /api/team/routing-rules`.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { teamClient } from '@/lib/api-client'
import type { RoutingRule, RoutingRuleKind } from '../schema'

export const routingRulesKeys = {
  all: ['routing-rules'] as const,
  list: ['routing-rules', 'list'] as const,
}

export interface UpsertRoutingRuleInput {
  kind: RoutingRuleKind
  keyword?: string | null
  pool?: string | null
  repUserId?: string | null
  priority?: number
}

export function useRoutingRules() {
  return useQuery({
    queryKey: routingRulesKeys.list,
    queryFn: async (): Promise<RoutingRule[]> => {
      const r = await teamClient['routing-rules'].$get()
      if (!r.ok) throw new Error(`routing rules list failed: ${r.status}`)
      return (await r.json()) as unknown as RoutingRule[]
    },
  })
}

export function useUpsertRoutingRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpsertRoutingRuleInput): Promise<RoutingRule> => {
      const r = await teamClient['routing-rules'].$post({ json: input })
      if (!r.ok) throw new Error(`routing rule upsert failed: ${r.status}`)
      return (await r.json()) as unknown as RoutingRule
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: routingRulesKeys.list }),
  })
}

export function useRemoveRoutingRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const r = await teamClient['routing-rules'][':id'].$delete({ param: { id } })
      if (!r.ok) throw new Error(`routing rule delete failed: ${r.status}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: routingRulesKeys.list }),
  })
}
