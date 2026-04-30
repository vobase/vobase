import { useWorkingMemory } from '@modules/messaging/hooks/use-working-memory'

interface WorkingMemoryPanelProps {
  conversationId: string
}

export function WorkingMemoryPanel({ conversationId }: WorkingMemoryPanelProps) {
  const { memory, isPending } = useWorkingMemory(conversationId)

  if (isPending) {
    return <p className="px-4 pb-4 text-[var(--color-fg-muted)] text-xs">Loading…</p>
  }

  if (!memory) {
    return <p className="px-4 pb-4 text-[var(--color-fg-muted)] text-sm">No memory yet for this agent.</p>
  }

  return (
    <div className="px-4 pb-4">
      <pre className="whitespace-pre-wrap break-words text-[var(--color-fg)] text-xs">{memory}</pre>
    </div>
  )
}
