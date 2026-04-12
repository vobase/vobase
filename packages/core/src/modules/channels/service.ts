import type {
  ChannelAdapter,
  OutboundMessage,
  SendResult,
} from '../../contracts/channels';
import type { VobaseDb } from '../../db/client';
import { logger } from '../../infra/logger';
import type { ProvisionChannelData } from '../../infra/platform';
import type { ChannelEventEmitter } from './events';
import { channelsLog } from './schema';

export interface ChannelSend {
  send(message: OutboundMessage): Promise<SendResult>;
}

/** Handler registered by modules to provision channel instances. */
export type ProvisionHandler = (
  data: ProvisionChannelData,
) => Promise<{ instanceId: string }>;

export interface ChannelsService {
  email: ChannelSend;
  whatsapp: ChannelSend;
  on: ChannelEventEmitter['on'];
  /** Look up a channel adapter by type name. Returns undefined if not registered. */
  get(type: string): ChannelSend | undefined;
  /** Look up the raw adapter by type name. Returns undefined if not registered. */
  getAdapter(type: string): ChannelAdapter | undefined;
  /** Register a channel adapter at runtime (hot-reload). */
  registerAdapter(name: string, adapter: ChannelAdapter): void;
  /** Unregister a channel adapter (e.g., on shared channel disconnect). */
  unregisterAdapter(name: string): void;
  /** Register a handler for channel provisioning (called from module init). */
  onProvision(handler: ProvisionHandler): void;
  /** Invoke the registered provision handler. Throws if none registered. */
  provision(data: ProvisionChannelData): Promise<{ instanceId: string }>;
}

interface ChannelsServiceDeps {
  db: VobaseDb;
  adapters: Map<string, ChannelAdapter>;
  emitter: ChannelEventEmitter;
}

async function logChannelEvent(
  db: VobaseDb,
  channel: string,
  direction: string,
  to: string,
  result: { success?: boolean; messageId?: string; error?: string },
  extra?: { from?: string; content?: string },
): Promise<void> {
  await db.insert(channelsLog).values({
    channel,
    direction,
    to,
    from: extra?.from ?? null,
    messageId: result.messageId ?? null,
    status: result.success !== false ? 'sent' : 'failed',
    content: extra?.content?.slice(0, 500) ?? null,
    error: result.error ?? null,
  });
}

/**
 * Creates a lazy ChannelSend that looks up the adapter at send-time (not construction-time).
 * This is critical for hot-reload: adapters registered after boot are picked up automatically.
 */
function createChannelSend(
  db: VobaseDb,
  channelName: string,
  adapters: Map<string, ChannelAdapter>,
  lookupNames?: string[],
): ChannelSend {
  return {
    async send(message: OutboundMessage): Promise<SendResult> {
      // Lazy lookup: check the adapters Map at send-time
      const names = lookupNames ?? [channelName];
      let adapter: ChannelAdapter | undefined;
      for (const name of names) {
        adapter = adapters.get(name);
        if (adapter) break;
      }

      if (!adapter) {
        throw new Error(
          `${channelName} channel is not configured. Connect it via /channels or add ${channelName} configuration to your createApp() config.`,
        );
      }

      try {
        const result = await adapter.send(message);
        await logChannelEvent(db, channelName, 'outbound', message.to, result, {
          content: message.text ?? message.template?.name,
        });
        return result;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`${channelName} channel send error`, {
          error: errorMsg,
          to: message.to,
        });
        const result: SendResult = {
          success: false,
          error: errorMsg,
          retryable: true,
        };
        await logChannelEvent(db, channelName, 'outbound', message.to, result, {
          content: message.text ?? message.template?.name,
        });
        return result;
      }
    },
  };
}

export function createChannelsService(
  deps: ChannelsServiceDeps,
): ChannelsService {
  const { db, adapters, emitter } = deps;
  let provisionHandler: ProvisionHandler | null = null;
  const channelSendCache = new Map<string, ChannelSend>();

  return {
    // Lazy lookup: email tries 'email', then 'resend', then 'smtp'
    email: createChannelSend(db, 'email', adapters, [
      'email',
      'resend',
      'smtp',
    ]),
    // Lazy lookup: whatsapp checks adapters Map at send-time
    whatsapp: createChannelSend(db, 'whatsapp', adapters),
    on: emitter.on.bind(emitter),
    get(type: string): ChannelSend | undefined {
      if (!adapters.has(type)) return undefined;
      let cached = channelSendCache.get(type);
      if (!cached) {
        cached = createChannelSend(db, type, adapters);
        channelSendCache.set(type, cached);
      }
      return cached;
    },
    getAdapter(type: string): ChannelAdapter | undefined {
      return adapters.get(type);
    },
    registerAdapter(name: string, adapter: ChannelAdapter) {
      adapters.set(name, adapter);
      channelSendCache.delete(name);
      logger.info(`Channel adapter registered (hot-reload): ${name}`);
    },
    unregisterAdapter(name: string) {
      adapters.delete(name);
      channelSendCache.delete(name);
      logger.info(`Channel adapter unregistered: ${name}`);
    },
    onProvision(handler: ProvisionHandler) {
      provisionHandler = handler;
    },
    async provision(data: ProvisionChannelData) {
      if (!provisionHandler) {
        throw new Error(
          'No channel provision handler registered. Call channels.onProvision() in a module init hook.',
        );
      }
      return provisionHandler(data);
    },
  };
}
