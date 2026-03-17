import type { ChannelEvent } from '../../contracts/channels';
import { logger } from '../../infra/logger';

type EventType = ChannelEvent['type'];
type EventHandler<T extends ChannelEvent = ChannelEvent> = (
  event: T,
) => Promise<void> | void;

/**
 * Typed event emitter for channel events.
 * Handlers execute non-blocking (fire-and-forget with error logging).
 * Webhook endpoints return 200 before handlers complete.
 */
export class ChannelEventEmitter {
  private handlers = new Map<EventType, EventHandler[]>();

  on<T extends EventType>(
    type: T,
    handler: EventHandler<Extract<ChannelEvent, { type: T }>>,
  ): void {
    const existing = this.handlers.get(type) ?? [];
    existing.push(handler as EventHandler);
    this.handlers.set(type, existing);
  }

  /**
   * Emit an event to all registered handlers.
   * Handlers run non-blocking — errors are logged, not propagated.
   */
  emit(event: ChannelEvent): void {
    const handlers = this.handlers.get(event.type);
    if (!handlers || handlers.length === 0) return;

    for (const handler of handlers) {
      Promise.resolve()
        .then(() => handler(event))
        .catch((error) => {
          logger.error('Channel event handler error', {
            eventType: event.type,
            channel: event.channel,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }
  }
}
