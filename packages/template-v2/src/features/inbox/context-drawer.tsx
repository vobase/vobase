import { useQueryState } from 'nuqs'
import { X } from 'lucide-react'
import { PaneHeader } from '@/components/layout/pane-header'
import { Button } from '@/components/ui/button'
import { ProfilePanel } from './profile-panel'
import { PendingApprovalsPanel } from './pending-approvals-panel'

interface ContextDrawerProps {
  conversationId: string
}

export function ContextDrawer({ conversationId }: ContextDrawerProps) {
  const [, setCtx] = useQueryState('ctx')

  return (
    <div className="flex h-full flex-col">
      <PaneHeader
        title="Context"
        density="detail"
        actions={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Close"
            onClick={() => setCtx(null)}
          >
            <X className="size-3.5" />
          </Button>
        }
      />
      <div className="flex-1 divide-y divide-[var(--color-border-subtle)] overflow-y-auto">
        <ProfilePanel conversationId={conversationId} />
        <PendingApprovalsPanel conversationId={conversationId} />
      </div>
    </div>
  )
}
