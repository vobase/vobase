import { ContextDrawer } from '@modules/messaging/components/context-drawer'
import { ConversationList } from '@modules/messaging/components/conversation-list'
import type { Conversation } from '@modules/messaging/schema'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { useQueryState } from 'nuqs'
import { useEffect, useMemo, useRef } from 'react'

import { ListDetailLayout } from '@/components/layout/list-detail-layout'
import { useKeyboardNav } from '@/hooks/use-keyboard-nav'
import { messagingClient } from '@/lib/api-client'
import { hydrateConversation } from '@/lib/rpc-utils'

async function fetchMessagingGrouped(): Promise<{
  rows: Conversation[]
  counts: { active: number; later: number; done: number }
}> {
  const r = await messagingClient.conversations.$get({ query: { grouped: '1' } })
  if (!r.ok) throw new Error('fetch failed')
  const body = await r.json()
  // The grouped branch returns { rows, counts }; the flat branch returns Conversation[].
  // Both are typed as a union here because the handler picks at runtime via `?grouped=1`.
  if (!('rows' in body)) throw new Error('grouped response expected')
  return { rows: body.rows.map(hydrateConversation), counts: body.counts }
}

export function MessagingLayout() {
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
    queryFn: fetchMessagingGrouped,
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

  useKeyboardNav({ context: 'messaging-list' })

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
  component: MessagingLayout,
})
