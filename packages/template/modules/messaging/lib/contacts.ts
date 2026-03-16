import type { VobaseDb } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { msgContacts } from '../schema';

/**
 * Find an existing contact by phone or create a new one.
 * Updates the profile name if it has changed.
 */
export async function findOrCreateContact(
  db: VobaseDb,
  phone: string,
  profileName?: string,
) {
  const existing = await db
    .select()
    .from(msgContacts)
    .where(eq(msgContacts.phone, phone))
    .get();

  if (existing) {
    // Update name if changed
    if (profileName && profileName !== existing.name) {
      const [updated] = await db
        .update(msgContacts)
        .set({ name: profileName })
        .where(eq(msgContacts.id, existing.id))
        .returning();
      return updated;
    }
    return existing;
  }

  const [contact] = await db
    .insert(msgContacts)
    .values({
      phone,
      name: profileName ?? null,
      channel: 'whatsapp',
    })
    .returning();

  return contact;
}
