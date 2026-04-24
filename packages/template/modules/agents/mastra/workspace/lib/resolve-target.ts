import { contacts } from '@modules/messaging/schema'
import type { VobaseDb } from '@vobase/core'
import { authUser } from '@vobase/core'
import { eq, sql } from 'drizzle-orm'

type TargetType = 'role' | 'user' | 'agent'

interface ResolveTargetInput {
  type: TargetType
  value: string
}

/** Parse a "type:value" target spec string (e.g. "role:operations") into { type, value }. */
export function parseTargetSpec(spec: string): ResolveTargetInput | null {
  const colon = spec.indexOf(':')
  if (colon === -1) return null
  const type = spec.slice(0, colon)
  const value = spec.slice(colon + 1)
  if (!['role', 'user', 'agent'].includes(type) || !value) return null
  return { type: type as TargetType, value }
}

/**
 * Resolve a target specifier to a concrete ID:
 * - role: query staff contacts where attributes contains value, return userId from authUser
 * - user: return value as-is (already a userId)
 * - agent: return "agent:{value}"
 */
export async function resolveTarget(db: VobaseDb, target: ResolveTargetInput): Promise<string | null> {
  if (target.type === 'agent') {
    return `agent:${target.value}`
  }

  if (target.type === 'user') {
    return target.value
  }

  // role: find first staff contact whose metadata contains the role/department
  const staffContacts = await db
    .select({ id: contacts.id, email: contacts.email, phone: contacts.phone })
    .from(contacts)
    .where(
      sql`${contacts.role} = 'staff' AND (
        ${contacts.attributes} @> ${JSON.stringify([target.value])}::jsonb
        OR ${contacts.attributes}->>'department' = ${target.value}
        OR ${contacts.attributes}->>'role' = ${target.value}
      )`,
    )
    .limit(1)

  if (staffContacts.length === 0) return null

  const staffContact = staffContacts[0]

  // Look up authUser by email; fall back to contact ID if no auth user exists
  if (staffContact.email) {
    const [user] = await db.select({ id: authUser.id }).from(authUser).where(eq(authUser.email, staffContact.email))
    if (user) return user.id
  }

  // Staff contact exists but has no auth user — use contact ID as fallback
  return staffContact.id
}
