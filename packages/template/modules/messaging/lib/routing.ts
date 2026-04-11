/**
 * Routing utilities — contact resolution from inbound events.
 */
import type { MessageReceivedEvent, VobaseDb } from '@vobase/core';
import { sql } from 'drizzle-orm';

import { contacts } from '../schema';

/**
 * Upsert a contact from an inbound message event.
 * Uses ON CONFLICT (phone) to prevent duplicate contacts from concurrent inbound messages.
 */
export async function findOrCreateContact(
  db: VobaseDb,
  event: MessageReceivedEvent,
): Promise<typeof contacts.$inferSelect> {
  if (!event.from) {
    // No phone — fall back to simple insert (email contacts don't have the same concurrency pressure)
    const [created] = await db
      .insert(contacts)
      .values({
        name: event.profileName || undefined,
        role: 'customer',
        metadata: {},
      })
      .returning();
    return created;
  }

  const [contact] = await db
    .insert(contacts)
    .values({
      phone: event.from,
      name: event.profileName || undefined,
      role: 'customer',
      metadata: {},
    })
    .onConflictDoUpdate({
      target: contacts.phone,
      set: {
        name: sql`COALESCE(EXCLUDED.name, ${contacts.name})`,
        updatedAt: new Date(),
      },
    })
    .returning();

  return contact;
}
