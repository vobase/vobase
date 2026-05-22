import { useContact } from '@modules/contacts/hooks/use-contacts'
import { Link } from '@tanstack/react-router'
import { ArrowUpRight } from 'lucide-react'

interface ProfilePanelProps {
  contactId: string
}

export function ProfilePanel({ contactId }: ProfilePanelProps) {
  const { data: contact } = useContact(contactId)

  return (
    <div className="p-4">
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
      <Link
        to="/contacts/$id"
        params={{ id: contactId }}
        className="mt-3 inline-flex items-center gap-1 text-primary text-xs hover:underline"
      >
        Open contact page
        <ArrowUpRight className="size-3" />
      </Link>
    </div>
  )
}
