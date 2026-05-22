import { ChevronDown, X } from 'lucide-react'
import { useQueryState } from 'nuqs'

import { PaneHeader } from '@/components/layout/pane-header'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { AttributesPanel } from './attributes-panel'
import { ContactMemoryPanel } from './contact-memory-panel'
import { ProfilePanel } from './profile-panel'

const SECTION_IDS = ['profile', 'attributes', 'memory'] as const
type SectionId = (typeof SECTION_IDS)[number]

interface ContextDrawerProps {
  contactId: string
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

export function ContextDrawer({ contactId }: ContextDrawerProps) {
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
          <ProfilePanel contactId={contactId} />
        </DrawerSection>
        <DrawerSection
          id="attributes"
          label="Attributes"
          collapsed={isCollapsed('attributes')}
          onToggle={() => toggle('attributes')}
        >
          <AttributesPanel contactId={contactId} />
        </DrawerSection>
        <DrawerSection id="memory" label="Memory" collapsed={isCollapsed('memory')} onToggle={() => toggle('memory')}>
          <ContactMemoryPanel contactId={contactId} />
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
          <span className="font-semibold text-[var(--color-fg-muted)] text-xs uppercase tracking-wider">{label}</span>
          <ChevronDown
            className={cn('size-3.5 text-[var(--color-fg-muted)] transition-transform', collapsed && '-rotate-90')}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  )
}
