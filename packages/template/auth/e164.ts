/**
 * Shared E.164 phone-format pattern — leading `+`, no leading zero, 7-15
 * digits total. Used by the better-auth phone-number plugin validator, the
 * team staff Zod handlers, and the staff/invite forms so all layers agree.
 */
export const E164_RE = /^\+[1-9]\d{6,14}$/u
