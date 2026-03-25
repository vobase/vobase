/**
 * Routing utilities — contact resolution from inbound events.
 *
 * The routing pipeline (routeInboundMessage) has been replaced by
 * chat-sdk handler dispatch in chat-handlers.ts.
 */
import type { MessageReceivedEvent, VobaseDb } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { contacts } from '../../contacts/schema';

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

/** Upsert a contact from an inbound message event. */
export async function findOrCreateContact(
  db: VobaseDb,
  event: MessageReceivedEvent,
): Promise<typeof contacts.$inferSelect> {
  const existing = await findContactByAddress(db, event);
  if (existing) return existing;

  const [created] = await db
    .insert(contacts)
    .values({
      phone: event.from || undefined,
      name: event.profileName || undefined,
      role: 'customer',
      metadata: {},
    })
    .returning();

  return created;
}
