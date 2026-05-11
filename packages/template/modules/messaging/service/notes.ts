/**
 * messaging internal notes — staff/agent scratchpad on the conversation timeline.
 *
 * Factory-DI service. `createNotesService({ db, scheduler?, conversations?, triageScheduler? })`
 * returns the bound API; `installNotesService(svc)` wires the module-scoped
 * handle used by the free-function wrappers below (which preserve the existing
 * import surface).
 *
 * Post-commit fan-out (Slice 1 of trigger-driven-capabilities): when a STAFF-
 * authored note is added, the service enqueues one staff-note wake per agent
 * explicitly `@-mentioned` in the body. Notes without an `@-mention` do not
 * wake any agent — the agent's working memory should only update when staff
 * pings the agent directly. Agent-authored notes never fan out (HARD
 * ping-pong filter, Risk #1).
 *
 * Learning-loop triage (Slice 2): staff-authored notes with NO @-mention
 * emit a `coaching_note` signal to `learning:triage` so the loop can observe
 * direct coaching without a staff-note wake being required.
 */

import { internalNotes } from '@modules/messaging/schema'
import { asc, eq } from 'drizzle-orm'

import { LEARNING_TRIAGE_JOB, type LearningTriageJobPayload } from '~/wake/learning/triage-job'
import type { InternalNote } from '../schema'
import { resolveAgentMentionsInBody } from './agent-mentions'
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

/**
 * Narrow port: produces one staff-note wake job per call. Decoupled from the
 * concrete `WakeScheduler`/`pg-boss` to keep notes.ts agents-module-free.
 * Wired in `modules/messaging/module.ts::init` to `ctx.jobs.send` against
 * `MESSAGING_STAFF_NOTE_TO_WAKE_JOB`.
 */
export interface StaffNoteScheduler {
  enqueueStaffNote(opts: {
    conversationId: string
    noteId: string
    authorUserId: string
    organizationId: string
    /** Id (without `agent:` prefix) of the mentioned agent that should wake. */
    mentionedAgentId?: string
    /** Snapshot of the conversation's agent-assignee id (without `agent:` prefix). */
    assigneeAgentId?: string
    /**
     * Verbatim note body, threaded into the wake-trigger payload so the
     * renderer can inline it (instead of forcing the agent to cat
     * INTERNAL-NOTES.md before it can decide what to do).
     */
    body: string
  }): Promise<void>
}

/**
 * Narrow port: enqueues one `learning:triage` job per call. Decoupled from
 * concrete pg-boss so notes.ts stays test-friendly.
 */
export interface NoteTriageScheduler {
  publish(name: string, payload: LearningTriageJobPayload): Promise<void>
}

/**
 * pg-boss singleton key for staff-note wakes. Each `(conversation, note,
 * mentionedAgent | 'self')` tuple gets a unique key so retries dedup but
 * distinct peer wakes never merge. Producer (`module.ts::init`) and tests
 * import this so the format is asserted, not duplicated.
 */
export function buildStaffNoteSingletonKey(opts: {
  conversationId: string
  noteId: string
  mentionedAgentId?: string
}): string {
  return `staff_note:${opts.conversationId}:${opts.noteId}:${opts.mentionedAgentId ?? 'self'}`
}

/**
 * Narrow read port: returns the agent id (without `agent:` prefix) that the
 * conversation is currently assigned to, or `null` when the assignee is staff
 * or unassigned.
 */
export interface ConversationsReader {
  getAssigneeAgentId(conversationId: string): Promise<string | null>
}

export interface NotesService {
  addNote(input: AddNoteInput): Promise<InternalNote>
  listNotes(conversationId: string): Promise<InternalNote[]>
}

export interface NotesServiceDeps {
  db: unknown
  /** Optional staff-note wake scheduler. When omitted, addNote skips fan-out. */
  scheduler?: StaffNoteScheduler | null
  /** Optional conversation reader for assignee resolution. When omitted, addNote skips fan-out. */
  conversations?: ConversationsReader | null
  /**
   * Optional learning-triage scheduler. When provided, staff-authored notes
   * with no @-mention emit a `coaching_note` signal (non-fatal, fire-and-forget).
   */
  triageScheduler?: NoteTriageScheduler | null
}

export function createNotesService(deps: NotesServiceDeps): NotesService {
  const db = deps.db as NotesDb
  const scheduler = deps.scheduler ?? null
  const conversationsReader = deps.conversations ?? null
  const triageScheduler = deps.triageScheduler ?? null

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

    // Post-commit fan-out — staff-authored only (HARD ping-pong filter).
    // Skipped when fan-out wiring isn't installed (e.g. unit-test contexts).
    if (input.author.kind !== 'agent' && scheduler && conversationsReader) {
      void runStaffNoteFanOut({
        scheduler,
        triageScheduler,
        conversations: conversationsReader,
        note: row,
        body: input.body,
        mentions: input.mentions,
        authorUserId: input.author.id,
      }).catch((err) => {
        console.error('[messaging/notes] staff-note fan-out failed (non-fatal):', err)
      })
    }

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

/**
 * Best-effort fan-out: one wake per `@-mentioned` agent. Plain notes with no
 * `@-mention` do not wake anyone — the agent's working memory only updates when
 * staff explicitly pings the agent. Each `enqueueStaffNote` call is wrapped
 * in its own try/catch so a single bad enqueue cannot starve the remaining
 * wakes.
 *
 * For notes with NO @-mention, emits a `coaching_note` learning-triage signal
 * when a triage scheduler is wired (non-fatal).
 */
async function runStaffNoteFanOut(opts: {
  scheduler: StaffNoteScheduler
  triageScheduler: NoteTriageScheduler | null
  conversations: ConversationsReader
  note: InternalNote
  body: string
  mentions: string[] | undefined
  authorUserId: string
}): Promise<void> {
  const { scheduler, triageScheduler, conversations, note, body, mentions, authorUserId } = opts

  const [mentionedAgentIds, assigneeAgentId] = await Promise.all([
    resolveAgentMentionsInBody({
      body,
      organizationId: note.organizationId,
      mentions,
    }).catch((err) => {
      console.error('[messaging/notes] resolveAgentMentionsInBody failed:', err)
      return [] as string[]
    }),
    conversations.getAssigneeAgentId(note.conversationId).catch((err) => {
      console.error('[messaging/notes] getAssigneeAgentId failed:', err)
      return null
    }),
  ])

  if (mentionedAgentIds.length === 0) {
    // No @-mention → emit coaching_note signal for the learning loop.
    // The assignee agent is the relevant agent; if unassigned, skip.
    if (triageScheduler && assigneeAgentId) {
      try {
        await triageScheduler.publish(LEARNING_TRIAGE_JOB, {
          organizationId: note.organizationId,
          agentId: assigneeAgentId,
          conversationId: note.conversationId,
          signal: { kind: 'coaching_note', noteId: note.id, body: note.body },
        })
      } catch (err) {
        console.warn('[messaging/notes] triage enqueue failed (coaching_note):', err)
      }
    }
    return
  }

  const common = {
    conversationId: note.conversationId,
    noteId: note.id,
    authorUserId,
    organizationId: note.organizationId,
    body,
  }

  for (const mentionedId of mentionedAgentIds) {
    try {
      await scheduler.enqueueStaffNote({
        ...common,
        mentionedAgentId: mentionedId,
        assigneeAgentId: assigneeAgentId ?? undefined,
      })
    } catch (err) {
      console.error('[messaging/notes] staff-note wake enqueue failed:', err)
    }
  }
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
