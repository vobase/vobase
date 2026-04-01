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
import { eq } from 'drizzle-orm';

import { channelInstances } from '../schema';
import { createChannelBridge } from './chat-bridge';

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
  // state-pg reads DATABASE_URL automatically and creates its own pg.Pool
  const state = createPostgresState({
    keyPrefix: 'vobase',
    logger: createChatLogger(),
  });
  stateInstance = state;

  // Connect state (creates tables if needed)
  await state.connect();

  // Build bridge adapters for all active channel instances
  const adapters: Record<string, ReturnType<typeof createChannelBridge>> = {};

  const activeInstances = await deps.db
    .select()
    .from(channelInstances)
    .where(eq(channelInstances.status, 'active'));

  for (const instance of activeInstances) {
    try {
      // Verify core adapter exists for this channel type (throws for unconfigured — caught below)
      if (instance.type !== 'web') {
        const channelSend =
          deps.channels[instance.type as keyof typeof deps.channels];
        if (!channelSend) {
          logger.warn(
            '[conversations] Skipped channel instance — no core adapter configured',
            { instanceId: instance.id, type: instance.type },
          );
          continue;
        }
      }
      adapters[instance.id] = createChannelBridge(instance, {
        db: deps.db,
        scheduler: deps.scheduler,
      });
      logger.info('[conversations] Bridge adapter registered', {
        instanceId: instance.id,
        channelType: instance.type,
      });
    } catch {
      // Channel type not configured in core — skip this instance
      logger.warn(
        '[conversations] Skipped channel instance — no core adapter configured',
        { instanceId: instance.id, type: instance.type },
      );
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

/** Reinitialize Chat instance — called after channel instances change (connect/disconnect). */
export async function reinitChat(deps: ChatInitDeps): Promise<Chat> {
  chatInstance = null;
  stateInstance = null;
  return initChat(deps);
}
