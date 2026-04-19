import { useQuery } from '@tanstack/react-query'

interface WorkingMemoryResult {
  memory: string | null
}

async function fetchWorkingMemory(conversationId: string): Promise<WorkingMemoryResult> {
  const res = await fetch(`/api/agents/conversations/${conversationId}/working-memory`)
  if (res.status === 404) return { memory: null }
  if (!res.ok) throw new Error('Failed to fetch working memory')
  return res.json() as Promise<WorkingMemoryResult>
}

export function useWorkingMemory(conversationId: string) {
  const { data, isPending } = useQuery({
    queryKey: ['agents-working-memory', conversationId],
    queryFn: () => fetchWorkingMemory(conversationId),
    enabled: Boolean(conversationId),
  })
  return { memory: data?.memory ?? null, isPending }
}
