/**
 * inbox internal notes — staff/agent scratchpad on the conversation timeline.
 * `detectStaffSignals()` reads these rows on `approval_resumed` wakes.
 */

import type { InternalNote } from '@server/contracts/domain-types'
import type { AddNoteInput } from '@server/contracts/inbox-port'

let _db: unknown = null

export function setDb(db: unknown): void {
  _db = db
}

type NotesDb = {
  insert: (t: unknown) => {
    values: (v: unknown) => {
      returning: () => Promise<unknown[]>
    }
  }
  select: () => {
    from: (t: unknown) => {
      where: (c: unknown) => { orderBy: (col: unknown) => Promise<unknown[]> }
    }
  }
}

function requireDb(): NotesDb {
  if (!_db) throw new Error('inbox/notes: db not initialised — call setDb() in module init')
  return _db as NotesDb
}

export async function addNote(input: AddNoteInput): Promise<InternalNote> {
  const { internalNotes } = await import('@modules/inbox/schema')
  const db = requireDb()
  const rows = await db
    .insert(internalNotes)
    .values({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      authorType: input.author.kind,
      authorId: input.author.id,
      body: input.body,
      mentions: input.mentions ?? [],
      parentNoteId: input.parentNoteId ?? null,
    })
    .returning()
  const row = rows[0] as InternalNote | undefined
  if (!row) throw new Error('inbox/notes.addNote: insert returned no rows')
  return row
}

export async function listNotes(conversationId: string): Promise<InternalNote[]> {
  const { internalNotes } = await import('@modules/inbox/schema')
  const { asc, eq } = await import('drizzle-orm')
  const db = requireDb()
  const rows = await db
    .select()
    .from(internalNotes)
    .where(eq(internalNotes.conversationId, conversationId))
    .orderBy(asc(internalNotes.createdAt))
  return rows as InternalNote[]
}
