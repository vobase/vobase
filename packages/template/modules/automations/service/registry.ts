import { z } from 'zod'

// Phase 1 registry. Slice B adds the 5 notification events. For US-004
// only the `cron` event exists (producer: wake/heartbeat.ts).
//
// To add an event: (a) add Zod schema below, (b) add a producer file path
// to scripts/check-emit.config.ts::EMIT_REGISTRY, (c) call `emit(name, payload, { tx })`
// at the producer call site.

export const eventRegistry = {
  cron: z.object({
    scheduleId: z.string(),
    intendedRunAt: z.string(), // ISO timestamp
  }),
} as const

export type EventName = keyof typeof eventRegistry
export type EventPayload<E extends EventName> = z.infer<(typeof eventRegistry)[E]>
