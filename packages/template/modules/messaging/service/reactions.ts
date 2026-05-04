/**
 * Message reactions service.
 * Sole writer for `messaging.message_reactions` (check:shape enforced).
 */

import { messageReactions } from '@modules/messaging/schema'
import { and, eq } from 'drizzle-orm'

type Tx = {
  insert: (t: unknown) => {
    values: (v: unknown) => { onConflictDoNothing: () => { returning: () => Promise<unknown[]> } }
  }
  delete: (t: unknown) => { where: (c: unknown) => Promise<void> }
}
type DbHandle = {
  transaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>
}

export interface UpsertReactionInput {
  messageId: string
  channelInstanceId: string
  fromExternal: string
  emoji: string
}

export interface RemoveReactionInput {
  messageId: string
  fromExternal: string
  emoji: string
}

export interface ReactionsService {
  upsertReaction(input: UpsertReactionInput): Promise<void>
  removeReaction(input: RemoveReactionInput): Promise<void>
}

export interface ReactionsServiceDeps {
  db: unknown
}

export function createReactionsService(deps: ReactionsServiceDeps): ReactionsService {
  const db = deps.db as DbHandle

  async function upsertReaction(input: UpsertReactionInput): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .insert(messageReactions)
        .values({
          messageId: input.messageId,
          channelInstanceId: input.channelInstanceId,
          reactorExternalId: input.fromExternal,
          emoji: input.emoji,
        })
        .onConflictDoNothing()
        .returning()
    })
  }

  async function removeReaction(input: RemoveReactionInput): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .delete(messageReactions)
        .where(
          and(
            eq(messageReactions.messageId, input.messageId),
            eq(messageReactions.reactorExternalId, input.fromExternal),
            eq(messageReactions.emoji, input.emoji),
          ),
        )
    })
  }

  return { upsertReaction, removeReaction }
}

let _currentReactionsService: ReactionsService | null = null

export function installReactionsService(svc: ReactionsService): void {
  _currentReactionsService = svc
}

export function __resetReactionsServiceForTests(): void {
  _currentReactionsService = null
}

function currentReactions(): ReactionsService {
  if (!_currentReactionsService) {
    throw new Error('messaging/reactions: service not installed — call installReactionsService()')
  }
  return _currentReactionsService
}

export async function upsertReaction(input: UpsertReactionInput): Promise<void> {
  return currentReactions().upsertReaction(input)
}

export async function removeReaction(input: RemoveReactionInput): Promise<void> {
  return currentReactions().removeReaction(input)
}
