/**
 * Shared presence-threshold constant. The frontend principal directory and
 * the backend mention-fan-out service both apply the same window when
 * deciding whether a staff member counts as "online". Co-located here so
 * both sides import from a single canonical location.
 *
 * A staff member is treated as online when `availability === 'active'` AND
 * `lastSeenAt` falls within this window from now.
 */
export const PRESENCE_THRESHOLD_MS = 2 * 60 * 1000
