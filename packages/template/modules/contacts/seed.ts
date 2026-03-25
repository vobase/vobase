/**
 * Seed: contacts — demo customers and staff.
 */
import type { VobaseDb } from '@vobase/core';

import { contacts } from './schema';

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

export default async function seed(ctx: { db: VobaseDb }) {
  const { db } = ctx;

  const demoContacts = [
    {
      id: 'contact-cust-1',
      phone: '+6591234567',
      email: 'alice@example.com',
      name: 'Alice Tan',
      role: 'customer' as const,
      metadata: {},
    },
    {
      id: 'contact-cust-2',
      phone: '+6598765432',
      email: 'bob@example.com',
      name: 'Bob Lee',
      role: 'customer' as const,
      metadata: {},
    },
    {
      id: 'contact-cust-3',
      phone: '+6587654321',
      email: 'carol@example.com',
      name: 'Carol Wong',
      role: 'customer' as const,
      metadata: {},
    },
    {
      id: 'contact-staff-1',
      phone: '+6590001111',
      email: 'staff1@example.com',
      name: 'David Lim',
      role: 'staff' as const,
      metadata: {},
    },
    {
      id: 'contact-staff-2',
      phone: '+6590002222',
      email: 'staff2@example.com',
      name: 'Eve Chen',
      role: 'staff' as const,
      metadata: {},
    },
  ];

  await db.insert(contacts).values(demoContacts).onConflictDoNothing();

  console.log(`${green('✓')} Seeded ${demoContacts.length} contacts`);
}
