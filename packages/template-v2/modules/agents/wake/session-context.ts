/**
 * Per-wake session-context resolution.
 *
 * Reads the channel kind, channel display label, contact identity, and the
 * (optional) staff-assignee display name once at wake start. The result is
 * baked into the frozen system prompt and MUST NOT change mid-wake — the
 * provider's prefix cache is byte-keyed on the prompt.
 *
 * All sub-lookups are best-effort: missing rows / DB errors render as
 * `(unknown)` in the prompt block rather than throwing, so the block stays
 * structurally identical across wakes (cache stability).
 */

import { channelInstances } from '@modules/channels/schema'
import { get as getContact } from '@modules/contacts/service/contacts'
import type { Conversation } from '@modules/messaging/schema'
import { authUser } from '@vobase/core'
import { eq } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'

export type { SessionContext } from './frozen-prompt-builder'

import type { SessionContext } from './frozen-prompt-builder'

export interface ResolveSessionContextInput {
  db: ScopedDb | undefined
  conv: Conversation
  contactId: string
}

export async function resolveSessionContext(input: ResolveSessionContextInput): Promise<SessionContext> {
  const contact = await getContact(input.contactId).catch(() => null)

  let channelKind: string | null = null
  let channelLabel: string | null = null
  let staffAssigneeDisplayName: string | null = null

  if (input.db) {
    try {
      const rows = await input.db
        .select({ channel: channelInstances.channel, displayName: channelInstances.displayName })
        .from(channelInstances)
        .where(eq(channelInstances.id, input.conv.channelInstanceId))
        .limit(1)
      const row = rows[0]
      if (row) {
        channelKind = row.channel
        channelLabel = row.displayName
      }
    } catch {
      /* swallow — fallback to (unknown) */
    }

    if (input.conv.assignee.startsWith('user:')) {
      try {
        const userId = input.conv.assignee.slice('user:'.length)
        const rows = await input.db
          .select({ name: authUser.name, email: authUser.email })
          .from(authUser)
          .where(eq(authUser.id, userId))
          .limit(1)
        const row = rows[0]
        if (row) staffAssigneeDisplayName = row.name ?? row.email
      } catch {
        /* swallow */
      }
    }
  }

  return {
    channelKind,
    channelLabel,
    contactDisplayName: contact?.displayName ?? null,
    contactIdentifier: contact?.phone ?? contact?.email ?? null,
    staffAssigneeDisplayName,
    conversationStatus: input.conv.status,
    customerSince: contact?.createdAt ?? null,
  }
}
