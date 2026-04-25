/**
 * messaging internal notes — staff/agent scratchpad on the conversation timeline.
 * `detectStaffSignals()` reads these rows on `approval_resumed` wakes.
 *
 * Factory-DI service. `createNotesService({ db })` returns the bound
 * API; `installNotesService(svc)` wires the module-scoped handle used by the
 * free-function wrappers below (which preserve the existing import surface).
 */

import { internalNotes } from '@modules/messaging/schema'
import { asc, eq } from 'drizzle-orm'

import type { InternalNote } from '../schema'
import type { AddNoteInput } from './types'

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

export interface NotesService {
  addNote(input: AddNoteInput): Promise<InternalNote>
  listNotes(conversationId: string): Promise<InternalNote[]>
}

export interface NotesServiceDeps {
  db: unknown
}

export function createNotesService(deps: NotesServiceDeps): NotesService {
  const db = deps.db as NotesDb

  async function addNote(input: AddNoteInput): Promise<InternalNote> {
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
    if (!row) throw new Error('messaging/notes.addNote: insert returned no rows')
    return row
  }

  async function listNotes(conversationId: string): Promise<InternalNote[]> {
    const rows = await db
      .select()
      .from(internalNotes)
      .where(eq(internalNotes.conversationId, conversationId))
      .orderBy(asc(internalNotes.createdAt))
    return rows as InternalNote[]
  }

  return { addNote, listNotes }
}

let _currentNotesService: NotesService | null = null

export function installNotesService(svc: NotesService): void {
  _currentNotesService = svc
}

export function __resetNotesServiceForTests(): void {
  _currentNotesService = null
}

function current(): NotesService {
  if (!_currentNotesService) {
    throw new Error('messaging/notes: service not installed — call installNotesService() in module init')
  }
  return _currentNotesService
}

// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function addNote(input: AddNoteInput): Promise<InternalNote> {
  return current().addNote(input)
}

// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function listNotes(conversationId: string): Promise<InternalNote[]> {
  return current().listNotes(conversationId)
}
