import type { Contact, Conversation } from '@server/contracts/domain-types'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PaneHeader } from '@/components/layout/pane-header'
import { Button } from '@/components/ui/button'
import { fetchApprovals } from '@/features/inbox/api/use-decide-approval'
import { useKeyboardNav } from '@/hooks/use-keyboard-nav'
import { ConversationRow } from './conversation-row'
import { type FilterKey, FilterTabBar } from './filter-tab-bar'

async function fetchConversations(): Promise<Conversation[]> {
  const r = await fetch('/api/inbox/conversations')
  if (!r.ok) throw new Error('fetch failed')
  return r.json()
}

async function fetchContacts(): Promise<Contact[]> {
  const r = await fetch('/api/contacts')
  if (!r.ok) throw new Error('fetch failed')
  return r.json()
}

export function filterConversations(
  convs: Conversation[],
  filter: FilterKey,
  pendingConvIds: ReadonlySet<string> = new Set(),
): Conversation[] {
  switch (filter) {
    case 'unread':
      return convs.filter((c) => c.status === 'active')
    case 'awaiting_approval':
      // Conversations flagged awaiting_approval OR with any pending approval row
      // (server-side approvalMutator sometimes lags on status transition; join to
      // pending_approvals so the Pending tab matches /approvals exactly).
      return convs.filter((c) => c.status === 'awaiting_approval' || pendingConvIds.has(c.id))
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

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ['contacts'],
    queryFn: fetchContacts,
  })

  const { data: approvals = [] } = useQuery({
    queryKey: ['approvals'],
    queryFn: fetchApprovals,
  })

  const contactById = useMemo(() => {
    const m = new Map<string, Contact>()
    for (const c of contacts) m.set(c.id, c)
    return m
  }, [contacts])

  const pendingConvIds = useMemo(
    () => new Set(approvals.filter((a) => a.status === 'pending').map((a) => a.conversationId)),
    [approvals],
  )

  const filtered = useMemo(
    () => filterConversations(conversations, activeFilter, pendingConvIds),
    [conversations, activeFilter, pendingConvIds],
  )

  const counts = useMemo<Partial<Record<FilterKey, number>>>(
    () => ({
      all: conversations.length,
      unread: conversations.filter((c) => c.status === 'active').length,
      awaiting_approval: conversations.filter((c) => c.status === 'awaiting_approval' || pendingConvIds.has(c.id))
        .length,
      assigned_to_me: conversations.filter((c) => c.assignee !== 'unassigned').length,
      archived: conversations.filter((c) => c.status === 'archived').length,
    }),
    [conversations, pendingConvIds],
  )

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
        actions={
          <Button size="icon-sm" variant="ghost" aria-label="Search">
            <Search className="size-4" />
          </Button>
        }
      />
      <FilterTabBar value={activeFilter} onChange={setActiveFilter} counts={counts} />
      {filtered.map((conv) => (
        <ConversationRow
          key={conv.id}
          conversation={conv}
          contact={contactById.get(conv.contactId)}
          isSelected={conv.id === selectedId}
          onClick={() => navigate({ to: '/inbox/$id', params: { id: conv.id } })}
        />
      ))}
    </>
  )
}

export { ConversationList }
