import { ChevronDown, X } from 'lucide-react'
import { useQueryState } from 'nuqs'
import { PaneHeader } from '@/components/layout/pane-header'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { PendingApprovalsPanel } from './pending-approvals-panel'
import { ProfilePanel } from './profile-panel'
import { RecentLearningsPanel } from './recent-learnings-panel'
import { WorkingMemoryPanel } from './working-memory-panel'

const SECTION_IDS = ['profile', 'working-memory', 'recent-learnings', 'pending-approvals'] as const
type SectionId = (typeof SECTION_IDS)[number]

interface ContextDrawerProps {
  conversationId: string
}

function useCollapsedSections() {
  const [raw, setRaw] = useQueryState('collapsed', { defaultValue: '' })
  const collapsed = new Set(raw ? raw.split(',') : [])

  function toggle(id: SectionId) {
    const next = new Set(collapsed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    void setRaw(next.size > 0 ? [...next].join(',') : null)
  }

  return { isCollapsed: (id: SectionId) => collapsed.has(id), toggle }
}

export function ContextDrawer({ conversationId }: ContextDrawerProps) {
  const [, setCtx] = useQueryState('ctx')
  const { isCollapsed, toggle } = useCollapsedSections()

  return (
    <div className="flex h-full flex-col">
      <PaneHeader
        title="Context"
        density="detail"
        actions={
          <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={() => void setCtx(null)}>
            <X className="size-3.5" />
          </Button>
        }
      />
      <div className="flex-1 divide-y divide-[var(--color-border-subtle)] overflow-y-auto">
        <DrawerSection
          id="profile"
          label="Profile"
          collapsed={isCollapsed('profile')}
          onToggle={() => toggle('profile')}
        >
          <ProfilePanel conversationId={conversationId} />
        </DrawerSection>
        <DrawerSection
          id="working-memory"
          label="Working Memory"
          collapsed={isCollapsed('working-memory')}
          onToggle={() => toggle('working-memory')}
        >
          <WorkingMemoryPanel conversationId={conversationId} />
        </DrawerSection>
        <DrawerSection
          id="recent-learnings"
          label="Recent Learnings"
          collapsed={isCollapsed('recent-learnings')}
          onToggle={() => toggle('recent-learnings')}
        >
          <RecentLearningsPanel conversationId={conversationId} />
        </DrawerSection>
        <DrawerSection
          id="pending-approvals"
          label="Pending Approvals"
          collapsed={isCollapsed('pending-approvals')}
          onToggle={() => toggle('pending-approvals')}
        >
          <PendingApprovalsPanel conversationId={conversationId} />
        </DrawerSection>
      </div>
    </div>
  )
}

function DrawerSection({
  label,
  collapsed,
  onToggle,
  children,
}: {
  id: SectionId
  label: string
  collapsed: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <Collapsible open={!collapsed}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3"
          aria-expanded={!collapsed}
          onClick={onToggle}
        >
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-fg-muted)]">{label}</span>
          <ChevronDown
            className={cn('size-3.5 text-[var(--color-fg-muted)] transition-transform', collapsed && '-rotate-90')}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  )
}
