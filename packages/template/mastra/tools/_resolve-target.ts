import type { VobaseDb } from '@vobase/core';
import { authUser } from '@vobase/core';
import { eq, sql } from 'drizzle-orm';

import { contacts } from '../../modules/ai/schema';

type TargetType = 'role' | 'user' | 'agent';

interface ResolveTargetInput {
  type: TargetType;
  value: string;
}

/**
 * Resolve a target specifier to a concrete ID:
 * - role: query staff contacts where metadata.roles contains value, return userId from authUser
 * - user: return value as-is (already a userId)
 * - agent: return "agent:{value}"
 */
export async function resolveTarget(
  db: VobaseDb,
  target: ResolveTargetInput,
): Promise<string | null> {
  if (target.type === 'agent') {
    return `agent:${target.value}`;
  }

  if (target.type === 'user') {
    return target.value;
  }

  // role: find first staff contact whose metadata.roles includes the value
  const staffContacts = await db
    .select({ id: contacts.id, email: contacts.email, phone: contacts.phone })
    .from(contacts)
    .where(
      sql`${contacts.role} = 'staff' AND ${contacts.metadata} @> ${JSON.stringify([target.value])}::jsonb`,
    )
    .limit(1);

  if (staffContacts.length === 0) return null;

  const staffContact = staffContacts[0];

  // Look up authUser by email
  if (staffContact.email) {
    const [user] = await db
      .select({ id: authUser.id })
      .from(authUser)
      .where(eq(authUser.email, staffContact.email));
    if (user) return user.id;
  }

  return null;
}
