import type { Contact } from '@modules/contacts/schema'
import { useQuery } from '@tanstack/react-query'

interface ProfilePanelProps {
  conversationId: string
}

type ContactSlice = Pick<Contact, 'displayName' | 'phone' | 'email'>

async function fetchConversationContact(id: string): Promise<{ contact?: ContactSlice }> {
  const r = await fetch(`/api/messaging/conversations/${id}`)
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
      <p className="mb-3 font-semibold text-[var(--color-fg-muted)] text-xs uppercase tracking-wider">Profile</p>
      <dl className="space-y-2">
        <div>
          <dt className="text-[var(--color-fg-muted)] text-xs">Name</dt>
          <dd className="text-[var(--color-fg)] text-sm">{contact?.displayName ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-fg-muted)] text-xs">Phone</dt>
          <dd className="text-[var(--color-fg)] text-sm">{contact?.phone ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-fg-muted)] text-xs">Email</dt>
          <dd className="text-[var(--color-fg)] text-sm">{contact?.email ?? '—'}</dd>
        </div>
      </dl>
    </div>
  )
}
