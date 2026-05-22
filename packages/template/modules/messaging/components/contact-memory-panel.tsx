import { useContact } from '@modules/contacts/hooks/use-contacts'

import { MessageResponse } from '@/components/ai-elements/message'

interface ContactMemoryPanelProps {
  contactId: string
}

/** Per-contact memory (`contacts.memory`) — what the agent has learned about
 *  this customer. Contact-scoped, so it changes as you switch conversations.
 *  Rendered as markdown in the app's normal (sans-serif) font. */
export function ContactMemoryPanel({ contactId }: ContactMemoryPanelProps) {
  const { data: contact, isPending } = useContact(contactId)

  if (isPending) {
    return <p className="px-4 pb-4 text-[var(--color-fg-muted)] text-xs">Loading…</p>
  }

  const memory = contact?.memory?.trim()
  if (!memory) {
    return <p className="px-4 pb-4 text-[var(--color-fg-muted)] text-sm">No memory yet for this contact.</p>
  }

  return (
    <div className="px-4 pb-4 text-[var(--color-fg)] text-xs">
      <MessageResponse>{memory}</MessageResponse>
    </div>
  )
}
