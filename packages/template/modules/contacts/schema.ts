import { nanoidPrimaryKey } from '@vobase/core/schema';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgSchema,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * Shared pgSchema for contacts + conversations modules (AD-3).
 * Both modules define tables here so intra-schema `.references()` work.
 * Re-exported from conversations/schema.ts for co-location.
 */
export const conversationsPgSchema = pgSchema('conversations');

// ─── Contacts ────────────────────────────────────────────────────────

export const contacts = conversationsPgSchema.table(
  'contacts',
  {
    id: nanoidPrimaryKey(),
    phone: text('phone').unique(),
    email: text('email').unique(),
    name: text('name'),
    identifier: text('identifier'),
    role: text('role').notNull().default('customer'),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('contacts_phone_idx').on(table.phone),
    index('contacts_email_idx').on(table.email),
    index('contacts_role_idx').on(table.role),
    check('contacts_role_check', sql`role IN ('customer', 'lead', 'staff')`),
  ],
);
