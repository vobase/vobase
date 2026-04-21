import { ContextDrawer } from '@modules/inbox/components/context-drawer'
import { ConversationList } from '@modules/inbox/components/conversation-list'
import type { Conversation } from '@modules/inbox/schema'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { useQueryState } from 'nuqs'
import { useEffect, useMemo, useRef } from 'react'
import { ListDetailLayout } from '@/components/layout/list-detail-layout'
import { useKeyboardNav } from '@/hooks/use-keyboard-nav'

async function fetchInboxGrouped() {
  const r = await fetch('/api/inbox/conversations?grouped=1')
  if (!r.ok) throw new Error('fetch failed')
  return r.json() as Promise<{ rows: Conversation[]; counts: { active: number; later: number; done: number } }>
}

export function InboxLayout() {
  const navigate = useNavigate()
  const isContactSelected = useRouterState({
    select: (s) => /^\/inbox\/.+/.test(s.location.pathname),
  })
  const contactId = useRouterState({
    select: (s) => {
      const match = /^\/inbox\/([^/?#]+)/.exec(s.location.pathname)
      return match?.[1] ?? null
    },
  })
  const { data: grouped } = useQuery({
    queryKey: ['conversations', 'grouped'],
    queryFn: fetchInboxGrouped,
  })
  const convs = grouped?.rows ?? []
  const [convParam] = useQueryState('conv')
  const autoSelected = useRef(false)

  useEffect(() => {
    if (autoSelected.current || isContactSelected || convs.length === 0) return
    if (!matchMedia('(min-width: 1024px)').matches) return
    autoSelected.current = true
    navigate({ to: '/inbox/$contactId', params: { contactId: convs[0].contactId }, replace: true })
  }, [convs, isContactSelected, navigate])

  useKeyboardNav({ context: 'inbox-list' })

  const activeConvId = useMemo(() => {
    if (!contactId) return null
    const forContact = convs.filter((c) => c.contactId === contactId && c.channelInstanceType !== 'email')
    if (forContact.length === 0) return null
    if (convParam) {
      const match = forContact.find((c) => c.id === convParam)
      if (match) return match.id
    }
    return [...forContact].sort((a, b) => {
      const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
      const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
      return tb - ta
    })[0].id
  }, [contactId, convs, convParam])

  return (
    <ListDetailLayout
      list={<ConversationList />}
      detail={<Outlet />}
      right={activeConvId ? <ContextDrawer conversationId={activeConvId} /> : undefined}
    />
  )
}

export const Route = createFileRoute('/_app/inbox')({
  component: InboxLayout,
})
