import { useWorkingMemory } from '@modules/inbox/pages/api/use-working-memory'

interface WorkingMemoryPanelProps {
  conversationId: string
}

export function WorkingMemoryPanel({ conversationId }: WorkingMemoryPanelProps) {
  const { memory, isPending } = useWorkingMemory(conversationId)

  if (isPending) {
    return <p className="px-4 pb-4 text-xs text-[var(--color-fg-muted)]">Loading…</p>
  }

  if (!memory) {
    return <p className="px-4 pb-4 text-sm text-[var(--color-fg-muted)]">No memory yet for this agent.</p>
  }

  return (
    <div className="px-4 pb-4">
      <pre className="whitespace-pre-wrap break-words text-xs text-[var(--color-fg)]">{memory}</pre>
    </div>
  )
}
