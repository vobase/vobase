import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Inbox as InboxIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { ListDetailLayout } from '@/components/layout/list-detail-layout'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { useKeyboardNav } from '@/hooks/use-keyboard-nav'

async function fetchConversations() {
  const r = await fetch('/api/inbox/conversations')
  if (!r.ok) throw new Error('fetch failed')
  return r.json() as Promise<Array<{ id: string }>>
}

// Placeholder until IL lands with <ConversationList />
function ConversationListSlot() {
  return <div className="p-4 text-xs text-[var(--color-fg-muted)]">Loading conversations…</div>
}

export function InboxLayout() {
  const navigate = useNavigate()
  const isConvSelected = useRouterState({
    select: (s) => /^\/inbox\/.+/.test(s.location.pathname),
  })
  const { data: convs = [] } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
  })
  const autoSelected = useRef(false)

  useEffect(() => {
    if (autoSelected.current || isConvSelected || convs.length === 0) return
    if (!matchMedia('(min-width: 1024px)').matches) return
    autoSelected.current = true
    navigate({ to: '/inbox/$id', params: { id: convs[0].id }, replace: true })
  }, [convs, isConvSelected, navigate])

  useKeyboardNav({ context: 'inbox-list' })

  return (
    <ListDetailLayout
      list={<ConversationListSlot />}
      detail={<Outlet />}
    />
  )
}

export function InboxEmptyState() {
  return (
    <div className="flex h-full items-center justify-center">
      <Empty>
        <EmptyMedia>
          <InboxIcon className="size-5" />
        </EmptyMedia>
        <EmptyTitle>No conversation selected</EmptyTitle>
        <EmptyDescription>Select a conversation from the list to get started.</EmptyDescription>
      </Empty>
    </div>
  )
}

// Placeholder — ID replaces with <ConversationDetail /> from src/features/inbox/conversation-detail.tsx
export function ConversationDetailPlaceholder() {
  return (
    <div className="flex h-full items-center justify-center text-xs text-[var(--color-fg-muted)]">
      Loading conversation…
    </div>
  )
}
