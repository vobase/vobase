import { useQuery } from '@tanstack/react-query'

import { agentsClient } from '@/lib/api-client'

interface WorkingMemoryResult {
  memory: string | null
}

async function fetchWorkingMemory(conversationId: string): Promise<WorkingMemoryResult> {
  const res = await agentsClient.conversations[':id']['working-memory'].$get({ param: { id: conversationId } })
  if (res.status === 404) return { memory: null }
  if (!res.ok) throw new Error('Failed to fetch working memory')
  return (await res.json()) as unknown as WorkingMemoryResult
}

export function useWorkingMemory(conversationId: string) {
  const { data, isPending } = useQuery({
    queryKey: ['agents-working-memory', conversationId],
    queryFn: () => fetchWorkingMemory(conversationId),
    enabled: Boolean(conversationId),
  })
  return { memory: data?.memory ?? null, isPending }
}
