/**
 * Chat instance — initializes chat-sdk with bridge adapters and state-pg.
 *
 * Replaces the hand-rolled in-memory state with real chat-sdk orchestration.
 * state-pg creates 4 tables (chat_state_subscriptions, chat_state_locks,
 * chat_state_cache, chat_state_lists) outside Drizzle — managed by state-pg directly.
 */

import { createPostgresState } from '@chat-adapter/state-pg';
import type { ChannelsService, Scheduler, VobaseDb } from '@vobase/core';
import { logger } from '@vobase/core';
import type { Logger as ChatLogger, StateAdapter } from 'chat';
import { Chat } from 'chat';

import { createChannelBridge } from './chat-bridge';
import { createPGlitePoolAdapter, type PoolLike } from './pglite-pool-adapter';

// ─── Types ───────────────────────────────────────────────────────────

interface ChatInitDeps {
  db: VobaseDb;
  scheduler: Scheduler;
  channels: ChannelsService;
}

// ─── Singleton ───────────────────────────────────────────────────────

let chatInstance: Chat | null = null;
let stateInstance: StateAdapter | null = null;

/** Get the Chat instance. Throws if not initialized. */
export function getChat(): Chat {
  if (!chatInstance)
    throw new Error('Chat not initialized. Call initChat first.');
  return chatInstance;
}

/** Get the state adapter directly (for web chat locking, state reads). */
export function getChatState(): StateAdapter {
  if (!stateInstance)
    throw new Error('Chat state not initialized. Call initChat first.');
  return stateInstance;
}

// ─── Logger bridge ───────────────────────────────────────────────────

function createChatLogger(): ChatLogger {
  return {
    debug(message: string, ...args: unknown[]) {
      logger.debug(`[chat-sdk] ${message}`, ...args);
    },
    info(message: string, ...args: unknown[]) {
      logger.info(`[chat-sdk] ${message}`, ...args);
    },
    warn(message: string, ...args: unknown[]) {
      logger.warn(`[chat-sdk] ${message}`, ...args);
    },
    error(message: string, ...args: unknown[]) {
      logger.error(`[chat-sdk] ${message}`, ...args);
    },
    child(prefix: string): ChatLogger {
      return {
        debug(msg: string, ...a: unknown[]) {
          logger.debug(`[chat-sdk:${prefix}] ${msg}`, ...a);
        },
        info(msg: string, ...a: unknown[]) {
          logger.info(`[chat-sdk:${prefix}] ${msg}`, ...a);
        },
        warn(msg: string, ...a: unknown[]) {
          logger.warn(`[chat-sdk:${prefix}] ${msg}`, ...a);
        },
        error(msg: string, ...a: unknown[]) {
          logger.error(`[chat-sdk:${prefix}] ${msg}`, ...a);
        },
        child: createChatLogger().child,
      };
    },
  };
}

// ─── Init ────────────────────────────────────────────────────────────

/** Initialize Chat instance with bridge adapters and state-pg. Call from module init. */
export async function initChat(deps: ChatInitDeps): Promise<Chat> {
  // Resolve pool — PGlite needs wrapping, real Postgres passes through
  const dbClient = (deps.db as unknown as { $client: unknown }).$client;
  let pool: PoolLike;

  if (
    dbClient &&
    typeof dbClient === 'object' &&
    'query' in dbClient &&
    !('connect' in dbClient && 'totalCount' in dbClient)
  ) {
    // PGlite — wrap as pg.Pool-shaped object
    const { PGlite } = await import('@electric-sql/pglite');
    pool = createPGlitePoolAdapter(dbClient as InstanceType<typeof PGlite>);
  } else {
    // Real Postgres pool — already pg.Pool compatible
    pool = dbClient as PoolLike;
  }

  // Create state adapter
  // Cast to satisfy state-pg's pg.Pool type — our PoolLike implements the subset it uses
  const state = createPostgresState({
    client: pool as never,
    keyPrefix: 'vobase',
    logger: createChatLogger(),
  });
  stateInstance = state;

  // Connect state (creates tables if needed)
  await state.connect();

  // Build bridge adapters for configured channels
  const adapters: Record<string, ReturnType<typeof createChannelBridge>> = {};
  const channelNames = ['whatsapp', 'email'] as const;

  for (const name of channelNames) {
    try {
      // Accessing an unconfigured channel throws (throw-proxy) — caught below
      const channelSend = deps.channels[name];
      if (channelSend) {
        adapters[name] = createChannelBridge(name, {
          db: deps.db,
          scheduler: deps.scheduler,
        });
      }
    } catch {
      // Channel not configured — skip
    }
  }

  // Create Chat instance
  chatInstance = new Chat({
    userName: 'vobase',
    adapters,
    state,
    logger: createChatLogger(),
  });

  return chatInstance;
}
