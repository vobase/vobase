/**
 * messaging internal notes — staff/agent scratchpad on the conversation timeline.
 * `detectStaffSignals()` reads these rows on `approval_resumed` wakes.
 *
 * Factory-DI service. `createNotesService({ db, scheduler?, conversations? })`
 * returns the bound API; `installNotesService(svc)` wires the module-scoped
 * handle used by the free-function wrappers below (which preserve the existing
 * import surface).
 *
 * Post-commit fan-out (Slice 1 of trigger-driven-capabilities): when a STAFF-
 * authored note is added, the service enqueues a supervisor wake for the
 * conversation assignee plus one peer wake per agent `@-mentioned` in the body.
 * Agent-authored notes never fan out (HARD ping-pong filter, Risk #1).
 */

import { internalNotes } from '@modules/messaging/schema'
import { asc, eq } from 'drizzle-orm'

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
 * Narrow port: produces one supervisor wake job per call. Decoupled from the
 * concrete `WakeScheduler`/`pg-boss` to keep notes.ts agents-module-free.
 * Wired in `modules/messaging/module.ts::init` to `ctx.jobs.send` against
 * `MESSAGING_SUPERVISOR_TO_WAKE_JOB`.
 */
export interface SupervisorScheduler {
  enqueueSupervisor(opts: {
    conversationId: string
    noteId: string
    authorUserId: string
    organizationId: string
    /** Set for peer wakes; undefined for the assignee self-wake. */
    mentionedAgentId?: string
    /** Snapshot of the conversation's agent-assignee id (without `agent:` prefix). */
    assigneeAgentId?: string
  }): Promise<void>
}

/**
 * pg-boss singleton key for supervisor wakes. Each `(conversation, note,
 * mentionedAgent | 'self')` tuple gets a unique key so retries dedup but
 * distinct peer wakes never merge. Producer (`module.ts::init`) and tests
 * import this so the format is asserted, not duplicated.
 */
export function buildSupervisorSingletonKey(opts: {
  conversationId: string
  noteId: string
  mentionedAgentId?: string
}): string {
  return `supervisor:${opts.conversationId}:${opts.noteId}:${opts.mentionedAgentId ?? 'self'}`
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
  /** Optional supervisor wake scheduler. When omitted, addNote skips fan-out. */
  scheduler?: SupervisorScheduler | null
  /** Optional conversation reader for assignee resolution. When omitted, addNote skips fan-out. */
  conversations?: ConversationsReader | null
}

export function createNotesService(deps: NotesServiceDeps): NotesService {
  const db = deps.db as NotesDb
  const scheduler = deps.scheduler ?? null
  const conversationsReader = deps.conversations ?? null

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
      void runSupervisorFanOut({
        scheduler,
        conversations: conversationsReader,
        note: row,
        body: input.body,
        mentions: input.mentions,
        authorUserId: input.author.id,
      }).catch((err) => {
        console.error('[messaging/notes] supervisor fan-out failed (non-fatal):', err)
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
 * Best-effort fan-out: assignee self-wake + one peer wake per `@-mentioned`
 * agent that isn't already the assignee. Each `enqueueSupervisor` call is
 * wrapped in its own try/catch so a single bad enqueue cannot starve the
 * remaining wakes.
 */
async function runSupervisorFanOut(opts: {
  scheduler: SupervisorScheduler
  conversations: ConversationsReader
  note: InternalNote
  body: string
  mentions: string[] | undefined
  authorUserId: string
}): Promise<void> {
  const { scheduler, conversations, note, body, mentions, authorUserId } = opts

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

  const common = {
    conversationId: note.conversationId,
    noteId: note.id,
    authorUserId,
    organizationId: note.organizationId,
  }

  if (assigneeAgentId) {
    try {
      await scheduler.enqueueSupervisor({
        ...common,
        mentionedAgentId: undefined,
        assigneeAgentId,
      })
    } catch (err) {
      console.error('[messaging/notes] supervisor self-wake enqueue failed:', err)
    }
  }

  for (const mentionedId of mentionedAgentIds) {
    if (mentionedId === assigneeAgentId) continue // Self-mention suppression.
    try {
      await scheduler.enqueueSupervisor({
        ...common,
        mentionedAgentId: mentionedId,
        assigneeAgentId: assigneeAgentId ?? undefined,
      })
    } catch (err) {
      console.error('[messaging/notes] supervisor peer-wake enqueue failed:', err)
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

/**
 * Classify a supervisor wake's triggering note relative to the current
 * agent's recent activity on the same conversation.
 *
 * Returns:
 *   - `ask_staff_answer` — the note immediately preceding the trigger was
 *     posted by THIS agent and explicitly @-mentioned someone (i.e. it was
 *     an `add_note` with `mentions` from this agent). The current note is therefore a
 *     direct answer to the agent's question; the wake should NOT strip
 *     customer-facing tools.
 *   - `coaching` — anything else (no prior note, prior note by staff, prior
 *     note by another agent, or prior note by this agent without a mention).
 *     This is staff-initiated feedback; the wake should default to
 *     read-and-internalise without sending another customer reply.
 *
 * Lives in messaging because the classification is purely a function of
 * note authorship + mentions — no wake-builder primitive needed.
 */
export async function classifySupervisorTrigger(opts: {
  conversationId: string
  triggerNoteId: string
  agentId: string
}): Promise<{ kind: 'ask_staff_answer' | 'coaching' }> {
  const notes = await listNotes(opts.conversationId)
  const idx = notes.findIndex((n) => n.id === opts.triggerNoteId)
  const prior = idx > 0 ? notes[idx - 1] : null
  const isAskStaffAnswer =
    !!prior && prior.authorType === 'agent' && prior.authorId === opts.agentId && prior.mentions.length > 0
  return { kind: isAskStaffAnswer ? 'ask_staff_answer' : 'coaching' }
}
