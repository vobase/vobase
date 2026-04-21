import type { Contact } from '@modules/contacts/schema'

export function deriveContactName(contact: Contact | null | undefined, fallback: string): string {
  if (!contact) return fallback
  return contact.displayName?.trim() || contact.email?.trim() || contact.phone?.trim() || fallback
}

export function deriveInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return name.slice(0, 2).toUpperCase()
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
