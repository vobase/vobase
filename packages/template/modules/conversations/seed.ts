/**
 * Seed: conversations — demo endpoints and sessions.
 */
import type { VobaseDb } from '@vobase/core';

import { endpoints, sessions } from './schema';

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

export default async function seed(ctx: { db: VobaseDb }) {
  const { db } = ctx;

  // Demo endpoints
  const demoEndpoints = [
    {
      id: 'ep-whatsapp-booking',
      name: 'WhatsApp Booking',
      channel: 'whatsapp',
      agentId: 'booking',
      assignmentPattern: 'direct' as const,
      config: {},
      enabled: true,
    },
    {
      id: 'ep-web-booking',
      name: 'Web Chat Booking',
      channel: 'web',
      agentId: 'booking',
      assignmentPattern: 'direct' as const,
      config: {},
      enabled: true,
    },
  ];

  await db.insert(endpoints).values(demoEndpoints).onConflictDoNothing();

  // Demo sessions
  const demoSessions = [
    {
      id: 'session-active-1',
      endpointId: 'ep-whatsapp-booking',
      contactId: 'contact-cust-1',
      agentId: 'booking',
      channel: 'whatsapp',
      status: 'active',
    },
    {
      id: 'session-completed-1',
      endpointId: 'ep-web-booking',
      contactId: 'contact-cust-2',
      agentId: 'booking',
      channel: 'web',
      status: 'completed',
      endedAt: new Date(),
    },
    {
      id: 'session-active-2',
      endpointId: 'ep-web-booking',
      contactId: 'contact-cust-3',
      agentId: 'booking',
      channel: 'web',
      status: 'active',
    },
  ];

  await db.insert(sessions).values(demoSessions).onConflictDoNothing();

  console.log(
    `${green('✓')} Seeded ${demoEndpoints.length} endpoints, ${demoSessions.length} sessions`,
  );
}
