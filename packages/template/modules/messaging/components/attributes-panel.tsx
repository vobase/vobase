import { useAttributeDefinitions } from '@modules/contacts/hooks/use-attributes'
import { useContact } from '@modules/contacts/hooks/use-contacts'
import type { AttributeValue } from '@modules/contacts/schema'

interface AttributesPanelProps {
  contactId: string
}

function formatValue(value: AttributeValue | undefined): string {
  if (value === undefined || value === null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

/** Org-defined contact attributes (`contacts.attributes` keyed by
 *  `contact_attribute_definitions`). Read-only here — edit on the contact page. */
export function AttributesPanel({ contactId }: AttributesPanelProps) {
  const { data: contact, isPending } = useContact(contactId)
  const { data: defs = [] } = useAttributeDefinitions()

  if (isPending) {
    return <p className="px-4 pb-4 text-[var(--color-fg-muted)] text-xs">Loading…</p>
  }

  if (defs.length === 0) {
    return <p className="px-4 pb-4 text-[var(--color-fg-muted)] text-sm">No attributes defined.</p>
  }

  const sorted = [...defs].sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <div className="p-4">
      <dl className="space-y-2">
        {sorted.map((def) => (
          <div key={def.id}>
            <dt className="text-[var(--color-fg-muted)] text-xs">{def.label}</dt>
            <dd className="text-[var(--color-fg)] text-sm">{formatValue(contact?.attributes[def.key])}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
