import { ContextDrawer } from '@modules/inbox/components/context-drawer'
import { ConversationList } from '@modules/inbox/components/conversation-list'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { ListDetailLayout } from '@/components/layout/list-detail-layout'
import { useKeyboardNav } from '@/hooks/use-keyboard-nav'

async function fetchConversations() {
  const r = await fetch('/api/inbox/conversations')
  if (!r.ok) throw new Error('fetch failed')
  return r.json() as Promise<Array<{ id: string }>>
}

export function InboxLayout() {
  const navigate = useNavigate()
  const isConvSelected = useRouterState({
    select: (s) => /^\/inbox\/.+/.test(s.location.pathname),
  })
  const conversationId = useRouterState({
    select: (s) => {
      const match = /^\/inbox\/(.+)/.exec(s.location.pathname)
      return match?.[1] ?? null
    },
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
      list={<ConversationList />}
      detail={<Outlet />}
      right={conversationId ? <ContextDrawer conversationId={conversationId} /> : undefined}
    />
  )
}

export const Route = createFileRoute('/_app/inbox')({
  component: InboxLayout,
})
