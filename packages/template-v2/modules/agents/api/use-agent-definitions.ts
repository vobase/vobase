import { useQuery } from '@tanstack/react-query'

export interface AgentDefinitionRow {
  id: string
  name: string
  enabled: boolean
}

export function useAgentDefinitions() {
  return useQuery({
    queryKey: ['agents', 'definitions'],
    queryFn: async (): Promise<AgentDefinitionRow[]> => {
      const r = await fetch('/api/agents/definitions')
      if (!r.ok) throw new Error(`agents.list failed: ${r.status}`)
      return r.json()
    },
  })
}
