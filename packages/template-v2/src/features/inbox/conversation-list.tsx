import type { Conversation } from '@server/contracts/domain-types'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PaneHeader } from '@/components/layout/pane-header'
import { Button } from '@/components/ui/button'
import { useKeyboardNav } from '@/hooks/use-keyboard-nav'
import { ConversationRow } from './conversation-row'
import { FilterChips, type FilterKey } from './filter-chips'

async function fetchConversations(): Promise<Conversation[]> {
  const r = await fetch('/api/inbox/conversations')
  if (!r.ok) throw new Error('fetch failed')
  return r.json()
}

export function filterConversations(convs: Conversation[], filter: FilterKey): Conversation[] {
  switch (filter) {
    case 'unread':
      return convs.filter((c) => c.status === 'active')
    case 'awaiting_approval':
      return convs.filter((c) => c.status === 'awaiting_approval')
    case 'assigned_to_me':
      return convs.filter((c) => c.assignee !== 'unassigned')
    case 'archived':
      return convs.filter((c) => c.status === 'archived')
    default:
      return convs
  }
}

function ConversationList() {
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all')
  const navigate = useNavigate()

  const selectedId = useRouterState({
    select: (s) => {
      const m = s.location.pathname.match(/^\/inbox\/(.+)/)
      return m?.[1] ?? null
    },
  })

  const { data: conversations = [] } = useQuery<Conversation[]>({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
  })

  const filtered = useMemo(() => filterConversations(conversations, activeFilter), [conversations, activeFilter])

  const selectedIndex = filtered.findIndex((c) => c.id === selectedId)

  useKeyboardNav({
    context: 'inbox-list',
    onSelectNext: () => {
      const next = filtered[selectedIndex + 1]
      if (next) navigate({ to: '/inbox/$id', params: { id: next.id } })
    },
    onSelectPrev: () => {
      const prev = filtered[selectedIndex - 1]
      if (prev) navigate({ to: '/inbox/$id', params: { id: prev.id } })
    },
  })

  return (
    <>
      <PaneHeader
        title="Inbox"
        meta={`${filtered.length}/${conversations.length}`}
        filters={<FilterChips active={activeFilter} onChange={setActiveFilter} />}
        actions={
          <Button size="icon-sm" variant="ghost" aria-label="Search">
            <Search className="size-4" />
          </Button>
        }
      />
      {filtered.map((conv) => (
        <ConversationRow
          key={conv.id}
          conversation={conv}
          isSelected={conv.id === selectedId}
          onClick={() => navigate({ to: '/inbox/$id', params: { id: conv.id } })}
        />
      ))}
    </>
  )
}

export { ConversationList }
