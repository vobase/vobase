/**
 * Routing utilities — contact resolution from inbound events.
 *
 * The routing pipeline (routeInboundMessage) has been replaced by
 * chat-sdk handler dispatch in chat-handlers.ts.
 */
import type { MessageReceivedEvent, VobaseDb } from '@vobase/core';
import { eq, sql } from 'drizzle-orm';

import { contacts } from '../schema';

/** Find a contact by phone (from event.from). */
export async function findContactByAddress(
  db: VobaseDb,
  event: MessageReceivedEvent,
): Promise<typeof contacts.$inferSelect | null> {
  if (!event.from) return null;

  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.phone, event.from));

  return contact ?? null;
}

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
