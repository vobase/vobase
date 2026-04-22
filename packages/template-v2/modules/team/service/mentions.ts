/**
 * Unread mention reads + dismissal writes — T7b. Queries
 * `inbox.internal_notes` where `'staff:<userId>'` appears in the `mentions`
 * array and no row exists in `inbox.mention_dismissals` for that (user, note).
 */

export interface UnreadMention {
  noteId: string
  conversationId: string
  authorType: 'agent' | 'staff' | 'system'
  authorId: string
  body: string
  createdAt: Date
}

interface MentionsDeps {
  db: unknown
}

export interface MentionsService {
  listUnread(userId: string, limit?: number): Promise<UnreadMention[]>
  unreadCount(userId: string): Promise<number>
  dismiss(userId: string, noteId: string): Promise<void>
  dismissAll(userId: string): Promise<number>
}

export function createMentionsService(deps: MentionsDeps): MentionsService {
  const db = deps.db as { select: Function; insert: Function; execute?: Function }

  async function listUnread(userId: string, limit = 50): Promise<UnreadMention[]> {
    const { internalNotes, mentionDismissals } = await import('@modules/inbox/schema')
    const { and, desc, eq, isNull, sql } = await import('drizzle-orm')
    const rows = (await db
      .select({
        noteId: internalNotes.id,
        conversationId: internalNotes.conversationId,
        authorType: internalNotes.authorType,
        authorId: internalNotes.authorId,
        body: internalNotes.body,
        createdAt: internalNotes.createdAt,
      })
      .from(internalNotes)
      .leftJoin(
        mentionDismissals,
        and(eq(mentionDismissals.noteId, internalNotes.id), eq(mentionDismissals.userId, userId)),
      )
      .where(
        and(sql`${internalNotes.mentions} @> ARRAY[${`staff:${userId}`}]::text[]`, isNull(mentionDismissals.noteId)),
      )
      .orderBy(desc(internalNotes.createdAt))
      .limit(limit)) as UnreadMention[]
    return rows
  }

  async function unreadCount(userId: string): Promise<number> {
    const { internalNotes, mentionDismissals } = await import('@modules/inbox/schema')
    const { and, eq, isNull, sql } = await import('drizzle-orm')
    const rows = (await db
      .select({ count: sql<number>`count(*)::int` })
      .from(internalNotes)
      .leftJoin(
        mentionDismissals,
        and(eq(mentionDismissals.noteId, internalNotes.id), eq(mentionDismissals.userId, userId)),
      )
      .where(
        and(sql`${internalNotes.mentions} @> ARRAY[${`staff:${userId}`}]::text[]`, isNull(mentionDismissals.noteId)),
      )) as Array<{ count: number }>
    return rows[0]?.count ?? 0
  }

  async function dismiss(userId: string, noteId: string): Promise<void> {
    const { mentionDismissals } = await import('@modules/inbox/schema')
    await db.insert(mentionDismissals).values({ userId, noteId }).onConflictDoNothing()
  }

  async function dismissAll(userId: string): Promise<number> {
    const unread = await listUnread(userId, 500)
    if (unread.length === 0) return 0
    const { mentionDismissals } = await import('@modules/inbox/schema')
    await db
      .insert(mentionDismissals)
      .values(unread.map((m) => ({ userId, noteId: m.noteId })))
      .onConflictDoNothing()
    return unread.length
  }

  return { listUnread, unreadCount, dismiss, dismissAll }
}

let _current: MentionsService | null = null
export function installMentionsService(svc: MentionsService): void {
  _current = svc
}
export function __resetMentionsServiceForTests(): void {
  _current = null
}
function current(): MentionsService {
  if (!_current) {
    throw new Error('team/mentions: service not installed — call installMentionsService() in module init')
  }
  return _current
}

export function listUnread(userId: string, limit?: number): Promise<UnreadMention[]> {
  return current().listUnread(userId, limit)
}
export function unreadCount(userId: string): Promise<number> {
  return current().unreadCount(userId)
}
export function dismiss(userId: string, noteId: string): Promise<void> {
  return current().dismiss(userId, noteId)
}
export function dismissAll(userId: string): Promise<number> {
  return current().dismissAll(userId)
}
