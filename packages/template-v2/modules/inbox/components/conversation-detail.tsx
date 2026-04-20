import type { Contact, Conversation, Message } from '@server/contracts/domain-types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, RefreshCcwIcon, RotateCcwIcon } from 'lucide-react'
import { PaneHeader } from '@/components/layout/pane-header'
import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxAnchor,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxTrigger,
} from '@/components/ui/combobox'
import { Status } from '@/components/ui/status'
import { useKeyboardNav } from '@/hooks/use-keyboard-nav'
import { useLifecycle } from '@modules/inbox/api/use-lifecycle'
import { useReassign } from '@modules/inbox/api/use-reassign'
import { deriveContactName } from '@modules/inbox/lib/contact'
import { Composer } from './composer'
import { InlineApprovalBanner } from './inline-approval-banner'
import { MessageThread } from './message-thread'
import { SnoozeMenu } from './snooze-menu'

const CURRENT_STAFF_ID = 'staff'

async function fetchConversation(id: string): Promise<Conversation> {
  const r = await fetch(`/api/inbox/conversations/${id}`)
  if (!r.ok) throw new Error(`fetch failed: ${r.status}`)
  return r.json()
}

async function fetchMessages(id: string): Promise<Message[]> {
  const r = await fetch(`/api/inbox/conversations/${id}/messages?limit=50`)
  if (!r.ok) throw new Error(`fetch failed: ${r.status}`)
  return r.json()
}

async function fetchConversationList(): Promise<Array<{ id: string; contactId?: string }>> {
  const r = await fetch('/api/inbox/conversations')
  if (!r.ok) throw new Error(`fetch failed: ${r.status}`)
  return r.json()
}

async function fetchContact(id: string): Promise<Contact | null> {
  const r = await fetch(`/api/contacts/${id}`)
  if (!r.ok) return null
  return r.json()
}

const STAFF_OPTIONS = [
  { value: 'bot', label: 'Bot' },
  { value: 'staff_1', label: 'Staff 1' },
  { value: 'staff_2', label: 'Staff 2' },
]

export function ConversationDetail() {
  const params = useParams({ strict: false }) as { id: string }
  const id = params.id
  const navigate = useNavigate()

  const { data: conv } = useQuery({
    queryKey: ['conversation', id],
    queryFn: () => fetchConversation(id),
  })

  const { data: messages = [] } = useQuery({
    queryKey: ['messages', id],
    queryFn: () => fetchMessages(id),
  })

  const { data: convList = [] } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversationList,
  })

  const { data: contact = null } = useQuery({
    queryKey: ['contact', conv?.contactId],
    queryFn: () => fetchContact(conv!.contactId),
    enabled: Boolean(conv?.contactId),
  })

  const title = deriveContactName(contact, conv?.contactId ?? id)

  const reassign = useReassign(id)
  const queryClient = useQueryClient()
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['conversations'] })
    queryClient.invalidateQueries({ queryKey: ['conversation', id] })
  }
  const resolveMut = useLifecycle(id, 'resolve', CURRENT_STAFF_ID)
  const reopenMut = useLifecycle(id, 'reopen', CURRENT_STAFF_ID)
  const resetMut = useLifecycle(id, 'reset', CURRENT_STAFF_ID)

  const idx = convList.findIndex((c) => c.id === id)
  const hasPrev = idx > 0
  const hasNext = idx >= 0 && idx < convList.length - 1

  const navigateTo = (targetId: string) => navigate({ to: '/inbox/$id', params: { id: targetId } })

  useKeyboardNav({
    context: 'inbox-detail',
    onSelectPrev: hasPrev ? () => navigateTo(convList[idx - 1].id) : undefined,
    onSelectNext: hasNext ? () => navigateTo(convList[idx + 1].id) : undefined,
  })

  return (
    <div className="flex h-full flex-col">
      <PaneHeader
        density="detail"
        title={title}
        meta={conv ? <Status variant={conv.status} label={conv.status} /> : undefined}
        actions={
          <div className="flex items-center gap-1">
            <div className="w-36">
              <Combobox
                value={conv?.assignee ?? ''}
                onValueChange={(val) => {
                  if (val) reassign.mutate(val)
                }}
              >
                <ComboboxAnchor className="h-7 border-0 bg-transparent px-1 shadow-none">
                  <ComboboxInput className="h-7 text-xs" placeholder="Assign to…" />
                  <ComboboxTrigger />
                </ComboboxAnchor>
                <ComboboxContent>
                  {STAFF_OPTIONS.map((opt) => (
                    <ComboboxItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </ComboboxItem>
                  ))}
                </ComboboxContent>
              </Combobox>
            </div>
            {conv?.status === 'active' && (
              <>
                <SnoozeMenu conversationId={id} by={CURRENT_STAFF_ID} onSnoozed={invalidate} />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => resolveMut.mutate()}
                  disabled={resolveMut.isPending}
                  data-testid="conversation-resolve"
                >
                  <CheckIcon className="size-4" />
                  Resolve
                </Button>
              </>
            )}
            {conv?.status === 'resolved' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => reopenMut.mutate()}
                disabled={reopenMut.isPending}
                data-testid="conversation-reopen"
              >
                <RotateCcwIcon className="size-4" />
                Reopen
              </Button>
            )}
            {conv?.status === 'failed' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => resetMut.mutate()}
                disabled={resetMut.isPending}
                data-testid="conversation-reset"
              >
                <RefreshCcwIcon className="size-4" />
                Retry
              </Button>
            )}
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={!hasPrev}
              className={!hasPrev ? 'opacity-30' : undefined}
              onClick={() => hasPrev && navigateTo(convList[idx - 1].id)}
              aria-label="Previous conversation"
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={!hasNext}
              className={!hasNext ? 'opacity-30' : undefined}
              onClick={() => hasNext && navigateTo(convList[idx + 1].id)}
              aria-label="Next conversation"
            >
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
        }
      />
      <InlineApprovalBanner conversationId={id} />
      <MessageThread messages={messages} />
      <Composer conversationId={id} />
    </div>
  )
}
