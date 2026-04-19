import { useQuery } from '@tanstack/react-query'
import type { Contact } from '@server/contracts/domain-types'

interface ProfilePanelProps {
  conversationId: string
}

type ContactSlice = Pick<Contact, 'displayName' | 'phone' | 'email'>

async function fetchConversationContact(id: string): Promise<{ contact?: ContactSlice }> {
  const r = await fetch(`/api/inbox/conversations/${id}`)
  if (!r.ok) throw new Error('fetch failed')
  return r.json()
}

export function ProfilePanel({ conversationId }: ProfilePanelProps) {
  const { data } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => fetchConversationContact(conversationId),
    enabled: Boolean(conversationId),
  })

  const contact = data?.contact

  return (
    <div className="p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-fg-muted)]">
        Profile
      </p>
      <dl className="space-y-2">
        <div>
          <dt className="text-xs text-[var(--color-fg-muted)]">Name</dt>
          <dd className="text-sm text-[var(--color-fg)]">{contact?.displayName ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--color-fg-muted)]">Phone</dt>
          <dd className="text-sm text-[var(--color-fg)]">{contact?.phone ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--color-fg-muted)]">Email</dt>
          <dd className="text-sm text-[var(--color-fg)]">{contact?.email ?? '—'}</dd>
        </div>
      </dl>
    </div>
  )
}
