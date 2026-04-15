import { workspaceFiles } from '@modules/agents/schema';
import {
  channelInstances,
  contacts,
  conversations,
} from '@modules/messaging/schema';
import type { VobaseDb } from '@vobase/core';
import { and, eq } from 'drizzle-orm';

/**
 * Materialize conversation state as markdown for the agent's virtual filesystem.
 * Queries the conversations table joined with channelInstances.
 */
export async function materializeState(
  db: VobaseDb,
  conversationId: string,
): Promise<string> {
  const rows = await db
    .select({
      status: conversations.status,
      assignee: conversations.assignee,
      onHold: conversations.onHold,
      holdReason: conversations.holdReason,
      priority: conversations.priority,
      outcome: conversations.outcome,
      autonomyLevel: conversations.autonomyLevel,
      createdAt: conversations.createdAt,
      resolvedAt: conversations.resolvedAt,
      channelType: channelInstances.type,
      channelLabel: channelInstances.label,
    })
    .from(conversations)
    .innerJoin(
      channelInstances,
      eq(conversations.channelInstanceId, channelInstances.id),
    )
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (rows.length === 0) return '# State\n\nConversation not found.';

  const row = rows[0];
  return formatState(row);
}

/** Pure formatting — testable without DB. */
export function formatState(row: {
  status: string;
  assignee: string;
  onHold: boolean;
  holdReason: string | null;
  priority: string | null;
  outcome: string | null;
  autonomyLevel: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  channelType: string;
  channelLabel: string;
}): string {
  const lines = [
    '# State',
    '',
    `status: ${row.status}`,
    `assignee: ${row.assignee}`,
    `channel: ${row.channelType} (${row.channelLabel})`,
    `on_hold: ${row.onHold}`,
  ];
  if (row.onHold && row.holdReason) {
    lines.push(`hold_reason: ${row.holdReason}`);
  }
  if (row.priority) {
    lines.push(`priority: ${row.priority}`);
  }
  if (row.outcome) {
    lines.push(`outcome: ${row.outcome}`);
  }
  if (row.autonomyLevel) {
    lines.push(`autonomy: ${row.autonomyLevel}`);
  }
  lines.push(`created: ${row.createdAt.toISOString()}`);
  if (row.resolvedAt) {
    lines.push(`resolved: ${row.resolvedAt.toISOString()}`);
  }
  return lines.join('\n');
}

/**
 * Materialize contact profile as markdown.
 */
export async function materializeProfile(
  db: VobaseDb,
  contactId: string,
): Promise<string> {
  const rows = await db
    .select({
      name: contacts.name,
      phone: contacts.phone,
      email: contacts.email,
      role: contacts.role,
      identifier: contacts.identifier,
      createdAt: contacts.createdAt,
    })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);

  if (rows.length === 0) return '# Profile\n\nContact not found.';

  const row = rows[0];
  return formatProfile(row);
}

/** Pure formatting — testable without DB. */
export function formatProfile(row: {
  name: string | null;
  phone: string | null;
  email: string | null;
  role: string;
  identifier: string | null;
  createdAt: Date;
}): string {
  const lines = ['# Profile', ''];
  if (row.name) lines.push(`name: ${row.name}`);
  if (row.phone) lines.push(`phone: ${row.phone}`);
  if (row.email) lines.push(`email: ${row.email}`);
  lines.push(`role: ${row.role}`);
  if (row.identifier) lines.push(`identifier: ${row.identifier}`);
  lines.push(`since: ${row.createdAt.toISOString()}`);
  return lines.join('\n');
}

/**
 * Materialize bookings for a contact as markdown.
 * Stub — returns placeholder until booking module exists.
 */
export async function materializeBookings(
  _db: VobaseDb,
  _contactId: string,
): Promise<string> {
  return formatBookings([]);
}

/** Pure formatting — testable without DB. */
export function formatBookings(
  _bookings: Array<{
    title: string;
    date: string;
    status: string;
  }>,
): string {
  if (_bookings.length === 0) {
    return '# Bookings\n\nNo bookings found.';
  }
  const lines = ['# Bookings', ''];
  for (const b of _bookings) {
    lines.push(`- ${b.date} | ${b.title} (${b.status})`);
  }
  return lines.join('\n');
}

/**
 * Load a workspace file by path, scoped to agent + contact.
 * Returns file content or null if not found.
 */
export async function loadWorkspaceFile(
  db: VobaseDb,
  agentId: string | null,
  contactId: string | null,
  path: string,
): Promise<string | null> {
  const conditions = [eq(workspaceFiles.path, path)];

  if (agentId) {
    conditions.push(eq(workspaceFiles.agentId, agentId));
  }
  if (contactId) {
    conditions.push(eq(workspaceFiles.contactId, contactId));
  }

  const rows = await db
    .select({ content: workspaceFiles.content })
    .from(workspaceFiles)
    .where(and(...conditions))
    .limit(1);

  return rows.length > 0 ? rows[0].content : null;
}

/**
 * Materialize relevant KB context for a conversation.
 * Stub — returns empty string until KB vector search is wired.
 */
export async function materializeRelevant(
  _db: VobaseDb,
  _conversationId: string,
): Promise<string> {
  return '';
}
