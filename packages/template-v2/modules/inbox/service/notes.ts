/**
 * inbox internal notes — scaffold only in Phase 1.
 */

import type { InternalNote } from '@server/contracts/domain-types'
import type { AddNoteInput } from '@server/contracts/inbox-port'

export async function addNote(_input: AddNoteInput): Promise<InternalNote> {
  throw new Error('not-implemented-in-phase-1: inbox/notes.addNote')
}

export async function listNotes(_conversationId: string): Promise<InternalNote[]> {
  throw new Error('not-implemented-in-phase-1: inbox/notes.listNotes')
}
