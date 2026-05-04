/**
 * Contact merge service skeleton.
 *
 * ## Spec (not yet implemented — tests assert the throw)
 *
 * `mergeContacts` merges two contacts within the same organization, transferring
 * all conversation history and messaging state from the absorbed contact to the
 * survivor. The absorbed contact is soft-deleted with a `mergedIntoId` pointer.
 *
 * ### Algorithm (ordered, all within a single transaction)
 *
 * 1. Load both contacts; assert they belong to `organizationId` and are not
 *    already merged (i.e. `mergedIntoId IS NULL`).
 *
 * 2. Determine survivor vs absorbed:
 *    - If both have conversations, prefer the contact with `status='active'` on
 *      the most recent conversation; break ties by latest `lastMessageAt`.
 *    - If only one has conversations, that contact is the survivor.
 *    - If neither has conversations, use whichever `survivorId` was passed.
 *
 * 3. For each `(channelInstanceId, threadKey)` pair where BOTH contacts have a
 *    conversation row:
 *    a. Select the "winner" conversation (prefer `status='active'`, else most
 *       recent `lastMessageAt`).
 *    b. Re-parent all messages from the loser conversation to the winner in
 *       their original `createdAt` order (UPDATE `messages.conversationId`).
 *    c. Append a `conversation_events` row with `type='contact.merged'`,
 *       `{ absorbedConversationId, absorbedContactId }` to the winner.
 *    d. Mark the loser conversation `status='resolved'`,
 *       `resolvedReason='contact_merge:<absorbedId>'`.
 *    e. Record `{ channelInstanceId, threadKey, survivorConvId, absorbedConvId,
 *       action: 'fold' }` in the reconciliations output.
 *
 * 4. For each conversation that exists ONLY on the absorbed contact's side
 *    (distinct `(channelInstanceId, threadKey)` not on the survivor):
 *    - UPDATE `conversations.contactId = survivorId`.
 *    - Record `{ action: 'archived' }` (misnomer inherited from legacy; these
 *      conversations are live, just re-parented).
 *
 * 5. UPDATE `message_reactions.fromExternal` wherever the absorbed contact's
 *    `staffChannelBindings.externalIdentifier` matches. This keeps reaction
 *    attribution correct across the merged history.
 *
 * 6. Soft-delete the absorbed contact:
 *    - `UPDATE contacts SET mergedIntoId = survivorId, updatedAt = now()`.
 *    - Do NOT hard-delete; the row serves as a permanent audit trail.
 *
 * 7. Append to `core.audit_log`:
 *    - `action='contact.merged'`, `actorId=by.id`, `actorKind=by.kind`,
 *      `targetId=absorbedId`, `metadata={ survivorId, reconciliations }`.
 *
 * ### Invariants
 *
 * - Idempotency: if `absorbedId` already has `mergedIntoId IS NOT NULL`, return
 *   the existing result rather than throwing — the merge already happened.
 * - The survivor's own `mergedIntoId` must remain NULL after the merge.
 * - `conversation_events` sole-writer rule is respected — this function writes
 *   directly to `conversation_events` via the journal service.
 * - Cross-module: this file lives in `messaging/service/` but references
 *   `contacts.mergedIntoId`. The contacts schema column is declared in
 *   `modules/contacts/schema.ts`; the FK is enforced post-push.
 *
 * ### Error cases
 *
 * - `contact_not_found` — either contact missing or wrong org.
 * - `already_merged` — absorbed contact already has `mergedIntoId` set to a
 *   DIFFERENT survivor than requested. Return existing result if same survivor.
 * - `self_merge` — `survivorId === absorbedId`.
 */

import { z } from 'zod'

// ─── Input schema ────────────────────────────────────────────────────────────

export const MergeContactsInput = z.object({
  survivorId: z.string().min(1),
  absorbedId: z.string().min(1),
  organizationId: z.string().min(1),
  by: z.object({
    id: z.string().min(1),
    kind: z.enum(['user', 'agent', 'system']),
  }),
})

export type MergeContactsInputType = z.infer<typeof MergeContactsInput>

// ─── Output types ────────────────────────────────────────────────────────────

export interface MergeReconciliation {
  channelInstanceId: string
  threadKey: string
  survivorConvId: string
  absorbedConvId: string
  action: 'fold' | 'archived'
}

export interface MergeContactsResult {
  survivorId: string
  reconciliations: MergeReconciliation[]
}

// ─── Skeleton implementation ─────────────────────────────────────────────────

/**
 * Merge two contacts, transferring all messages, conversations, and reactions
 * from the absorbed contact to the survivor.
 *
 * @throws {Error} Always — not yet implemented. Tests assert this throw.
 */
export async function mergeContacts(_input: MergeContactsInputType): Promise<MergeContactsResult> {
  throw new Error('not implemented')
}
