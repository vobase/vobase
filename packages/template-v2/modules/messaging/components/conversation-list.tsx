import type { Contact } from '@modules/contacts/schema'
import { fetchApprovals } from '@modules/messaging/hooks/use-decide-approval'
import { useGroupedConversations } from '@modules/messaging/hooks/use-grouped-conversations'
import { computeTab } from '@modules/messaging/service/bucketing'
import { useUnreadMentions } from '@modules/team/hooks/use-unread-mentions'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { PaneHeader } from '@/components/layout/pane-header'
import { Button } from '@/components/ui/button'
import { useKeyboardNav } from '@/hooks/use-keyboard-nav'
import { contactsClient } from '@/lib/api-client'
import type { Conversation } from '../schema'
import { ConversationRow } from './conversation-row'
import { type FilterKey, FilterTabBar } from './filter-tab-bar'
import { OwnershipFilter, type OwnershipOption, type OwnershipValue } from './ownership-filter'

async function fetchContacts(): Promise<Contact[]> {
  const r = await contactsClient.index.$get()
  if (!r.ok) throw new Error('fetch failed')
  return (await r.json()) as unknown as Contact[]
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

  const selectedContactId = useRouterState({
    select: (s) => {
      const m = s.location.pathname.match(/^\/inbox\/([^/?#]+)/)
      return m?.[1] ?? null
    },
  })

  const { data: grouped } = useGroupedConversations()
  const conversations = grouped?.rows ?? []
  const serverCounts = grouped?.counts

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

  const { data: unreadMentions = [] } = useUnreadMentions()
  const conversationsWithUnreadMention = useMemo(() => {
    const s = new Set<string>()
    for (const m of unreadMentions) s.add(m.conversationId)
    return s
  }, [unreadMentions])

  // Server already collapsed to one row per contact with tab-aware bucketing.
  // Client only filters by active tab + owner.
  const { filtered, counts, totalContacts } = useMemo(() => {
    const now = new Date()
    const inTab = conversations.filter((c) => computeTab(c, now) === activeFilter)
    const filtered = inTab.filter((c) => {
      const a = c.assignee
      return (
        ownerFilter === 'all' ||
        (ownerFilter === 'unassigned' && a === 'unassigned') ||
        (ownerFilter === 'mine' && a !== 'unassigned') ||
        a === ownerFilter
      )
    })
    const counts: Partial<Record<FilterKey, number>> = serverCounts ?? { active: 0, later: 0, done: 0 }
    const totalContacts = (counts.active ?? 0) + (counts.later ?? 0) + (counts.done ?? 0)
    return { filtered, counts, totalContacts }
  }, [conversations, activeFilter, ownerFilter, serverCounts])

  const ownershipOptions = useMemo(() => deriveOwnershipOptions(conversations), [conversations])

  const selectedIndex = filtered.findIndex((c) => c.contactId === selectedContactId)

  useKeyboardNav({
    context: 'messaging-list',
    onSelectNext: () => {
      const next = filtered[selectedIndex + 1]
      if (next) {
        navigate({ to: '/inbox/$contactId', params: { contactId: next.contactId }, search: { conv: next.id } })
      }
    },
    onSelectPrev: () => {
      const prev = filtered[selectedIndex - 1]
      if (prev) {
        navigate({ to: '/inbox/$contactId', params: { contactId: prev.contactId }, search: { conv: prev.id } })
      }
    },
  })

  return (
    <>
      <PaneHeader
        title="Inbox"
        meta={`${filtered.length}/${totalContacts}`}
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
          isSelected={conv.contactId === selectedContactId}
          hasUnreadMention={conversationsWithUnreadMention.has(conv.id)}
          onClick={() =>
            navigate({
              to: '/inbox/$contactId',
              params: { contactId: conv.contactId },
              search: { conv: conv.id },
            })
          }
        />
      ))}
    </>
  )
}

export { ConversationList }
