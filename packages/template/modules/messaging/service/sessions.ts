/**
 * 24-hour conversation window service.
 * Sole writer for `channels.conversation_sessions` (check:shape enforced).
 */

import { conversationSessions } from '@modules/channels/schema'
import { eq, sql } from 'drizzle-orm'

import { WINDOW_DURATION_MS, WINDOW_SESSION_STATE_CLOSED, WINDOW_SESSION_STATE_OPEN } from '../state'

type Tx = {
  insert: (t: unknown) => {
    values: (v: unknown) => {
      onConflictDoUpdate: (opts: unknown) => { returning: () => Promise<unknown[]> }
    }
  }
  update: (t: unknown) => { set: (v: unknown) => { where: (c: unknown) => Promise<void> } }
  select: () => { from: (t: unknown) => { where: (c: unknown) => { limit: (n: number) => Promise<unknown[]> } } }
}
type DbHandle = {
  transaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>
  select: () => { from: (t: unknown) => { where: (c: unknown) => { limit: (n: number) => Promise<unknown[]> } } }
}

export interface SessionsService {
  seedOnInbound(conversationId: string, channelInstanceId: string, now?: Date): Promise<void>
  checkWindow(conversationId: string): Promise<{ open: boolean; expiresAt: Date | null }>
  closeWindow(conversationId: string): Promise<void>
}

export interface SessionsServiceDeps {
  db: unknown
}

export function createSessionsService(deps: SessionsServiceDeps): SessionsService {
  const db = deps.db as DbHandle

  async function seedOnInbound(conversationId: string, channelInstanceId: string, now?: Date): Promise<void> {
    const openedAt = now ?? new Date()
    const expiresAt = new Date(openedAt.getTime() + WINDOW_DURATION_MS)
    await db.transaction(async (tx) => {
      await tx
        .insert(conversationSessions)
        .values({
          conversationId,
          channelInstanceId,
          sessionState: WINDOW_SESSION_STATE_OPEN,
          windowOpenedAt: openedAt,
          windowExpiresAt: expiresAt,
        })
        .onConflictDoUpdate({
          target: conversationSessions.conversationId,
          set: {
            sessionState: WINDOW_SESSION_STATE_OPEN,
            windowOpenedAt: openedAt,
            windowExpiresAt: expiresAt,
            updatedAt: sql`now()`,
          },
        })
        .returning()
    })
  }

  async function checkWindow(conversationId: string): Promise<{ open: boolean; expiresAt: Date | null }> {
    const rows = (await db
      .select()
      .from(conversationSessions)
      .where(eq(conversationSessions.conversationId, conversationId))
      .limit(1)) as Array<{ sessionState: string; windowExpiresAt: Date }>

    if (rows.length === 0) return { open: false, expiresAt: null }
    const row = rows[0]
    const now = new Date()
    const open = row.sessionState === WINDOW_SESSION_STATE_OPEN && row.windowExpiresAt > now
    return { open, expiresAt: row.windowExpiresAt }
  }

  async function closeWindow(conversationId: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .update(conversationSessions)
        .set({ sessionState: WINDOW_SESSION_STATE_CLOSED, updatedAt: sql`now()` })
        .where(eq(conversationSessions.conversationId, conversationId))
    })
  }

  return { seedOnInbound, checkWindow, closeWindow }
}

let _currentSessionsService: SessionsService | null = null

export function installSessionsService(svc: SessionsService): void {
  _currentSessionsService = svc
}

export function __resetSessionsServiceForTests(): void {
  _currentSessionsService = null
}

function currentSessions(): SessionsService {
  if (!_currentSessionsService) {
    throw new Error('messaging/sessions: service not installed — call installSessionsService()')
  }
  return _currentSessionsService
}

export async function seedOnInbound(conversationId: string, channelInstanceId: string, now?: Date): Promise<void> {
  return currentSessions().seedOnInbound(conversationId, channelInstanceId, now)
}

export async function checkWindow(conversationId: string): Promise<{ open: boolean; expiresAt: Date | null }> {
  return currentSessions().checkWindow(conversationId)
}

export async function closeWindow(conversationId: string): Promise<void> {
  return currentSessions().closeWindow(conversationId)
}

export { extractEchoMetadata, MetadataSchema } from './echo-metadata'
