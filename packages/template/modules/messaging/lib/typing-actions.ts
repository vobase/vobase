/**
 * Realtime `action` strings for typing-presence events. Encoded into the
 * `RealtimePayload.action` field so each side can ignore its own beacons
 * — customers don't see `typing.staff`, staff don't see `typing.customer`.
 *
 * Lives in `lib/` because both the backend service (`staff-ops.ts`) and
 * frontend hook (`use-conversation-typing.ts`) need it; backend service
 * files pull in Drizzle which transitively externalizes `node:crypto`
 * and breaks the browser bundle.
 */

export const TYPING_ACTIONS = {
  staff: 'typing.staff',
  customer: 'typing.customer',
} as const

export type TypingActor = keyof typeof TYPING_ACTIONS
