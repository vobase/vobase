import type { Contact } from '@modules/contacts/schema'
import { fetchApprovals } from '@modules/inbox/api/use-decide-approval'
import { computeTab } from '@modules/inbox/service/bucketing'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PaneHeader } from '@/components/layout/pane-header'
import { Button } from '@/components/ui/button'
import { useKeyboardNav } from '@/hooks/use-keyboard-nav'
import type { Conversation } from '../schema'
import { ConversationRow } from './conversation-row'
import { type FilterKey, FilterTabBar } from './filter-tab-bar'
import { OwnershipFilter, type OwnershipOption, type OwnershipValue } from './ownership-filter'

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
  owner: OwnershipValue = 'all',
  now: Date = new Date(),
): Conversation[] {
  return convs.filter((c) => {
    const tab = computeTab(c, now)
    if (tab !== filter) return false
    if (owner === 'all') return true
    if (owner === 'unassigned') return c.assignee === 'unassigned'
    if (owner === 'mine') return c.assignee !== 'unassigned'
    return c.assignee === owner
  })
}

function deriveOwnershipOptions(convs: Conversation[]): OwnershipOption[] {
  const seen = new Map<string, OwnershipOption>()
  for (const c of convs) {
    const a = c.assignee
    if (!a || a === 'unassigned') continue
    if (seen.has(a)) continue
    if (a.startsWith('agent:')) {
      seen.set(a, { value: a, label: a.slice(6), kind: 'agent' })
    } else if (a.startsWith('user:')) {
      seen.set(a, { value: a, label: a.slice(5), kind: 'staff' })
    } else {
      seen.set(a, { value: a, label: a, kind: 'staff' })
    }
  }
  return Array.from(seen.values())
}

function ConversationList() {
  const [activeFilter, setActiveFilter] = useState<FilterKey>('active')
  const [ownerFilter, setOwnerFilter] = useState<OwnershipValue>('all')
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

  // Pending approvals are implicitly surfaced in the Active tab now (status=awaiting_approval).
  useQuery({ queryKey: ['approvals'], queryFn: fetchApprovals })

  const contactById = useMemo(() => {
    const m = new Map<string, Contact>()
    for (const c of contacts) m.set(c.id, c)
    return m
  }, [contacts])

  const { filtered, counts } = useMemo(() => {
    const now = new Date()
    const counts: Partial<Record<FilterKey, number>> = { active: 0, later: 0, done: 0 }
    const filtered: Conversation[] = []
    for (const c of conversations) {
      const tab = computeTab(c, now)
      counts[tab] = (counts[tab] ?? 0) + 1
      if (tab !== activeFilter) continue
      const a = c.assignee
      const match =
        ownerFilter === 'all' ||
        (ownerFilter === 'unassigned' && a === 'unassigned') ||
        (ownerFilter === 'mine' && a !== 'unassigned') ||
        a === ownerFilter
      if (match) filtered.push(c)
    }
    return { filtered, counts }
  }, [conversations, activeFilter, ownerFilter])

  const ownershipOptions = useMemo(() => deriveOwnershipOptions(conversations), [conversations])

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
          <div className="flex items-center gap-0.5">
            <Button size="icon-sm" variant="ghost" aria-label="Search">
              <Search className="size-4" />
            </Button>
            <OwnershipFilter value={ownerFilter} onChange={setOwnerFilter} options={ownershipOptions} />
          </div>
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
