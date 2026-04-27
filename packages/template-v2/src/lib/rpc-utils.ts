/**
 * Hono typed-RPC hydration helpers.
 *
 * Hono's typed RPC client infers the JSON return type literally from
 * `c.json(rows)`. When a row contains Drizzle `timestamp` columns (typed as
 * `Date`), the inferred wire type on the client is `string` (because Hono
 * applies its own JSON-serialization mapping where `Date` → `string`). The
 * actual runtime values are also strings — so the type and the runtime agree
 * on the wire side.
 *
 * The rest of the app, however, models these fields as `Date` on the domain
 * interfaces (`Contact`, `PendingApproval`, `Conversation`, ...). These
 * helpers convert wire-format rows (with `string` dates) into domain rows
 * (with `Date` dates) so pages and hooks can keep using the existing
 * interfaces without an unsafe cast.
 *
 * Convention: pages/hooks should call `await client.foo.$get(...)`,
 * `.json()`, then map through the matching `hydrate*` helper. Adding a new
 * domain means adding one more narrow wrapper here.
 */

import type { ChangeProposalRow } from '@modules/changes/schema'
import type { Contact } from '@modules/contacts/schema'
import type { Conversation, PendingApproval } from '@modules/messaging/schema'

/**
 * Convert the named fields on `wire` from ISO strings to `Date`, returning a
 * new object whose type matches the domain interface `T`. Non-string values
 * (e.g. `null`) are passed through unchanged.
 *
 * The input is typed loosely as `object` rather than a derived `Wire<T>` —
 * Hono's inferred RPC return type sometimes diverges from the schema's
 * domain interface in ways unrelated to dates (extra columns, nominal type
 * aliases). Constraining the hydrator to a structural `Wire<T>` would forward
 * those mismatches into call sites. The trade-off: callers must supply the
 * right key list, and the return cast trusts the runtime shape from the API.
 * Per-domain wrappers below pin the date keys for each row type.
 */
export function hydrateDates<T extends object>(wire: object, keys: ReadonlyArray<keyof T>): T {
  const out: Record<string, unknown> = { ...wire }
  for (const key of keys) {
    const v = out[key as string]
    if (typeof v === 'string') {
      out[key as string] = new Date(v)
    }
  }
  return out as T
}

const CONTACT_DATE_KEYS = ['createdAt', 'updatedAt', 'marketingOptOutAt'] as const satisfies ReadonlyArray<
  keyof Contact
>
const APPROVAL_DATE_KEYS = ['createdAt', 'decidedAt'] as const satisfies ReadonlyArray<keyof PendingApproval>
const CONVERSATION_DATE_KEYS = [
  'createdAt',
  'updatedAt',
  'snoozedUntil',
  'snoozedAt',
  'lastMessageAt',
  'resolvedAt',
] as const satisfies ReadonlyArray<keyof Conversation>
const CHANGE_PROPOSAL_DATE_KEYS = ['createdAt', 'decidedAt'] as const satisfies ReadonlyArray<keyof ChangeProposalRow>

export function hydrateContact(row: object): Contact {
  return hydrateDates<Contact>(row, CONTACT_DATE_KEYS)
}

export function hydratePendingApproval(row: object): PendingApproval {
  return hydrateDates<PendingApproval>(row, APPROVAL_DATE_KEYS)
}

export function hydrateConversation(row: object): Conversation {
  return hydrateDates<Conversation>(row, CONVERSATION_DATE_KEYS)
}

export function hydrateChangeProposal(row: object): ChangeProposalRow {
  return hydrateDates<ChangeProposalRow>(row, CHANGE_PROPOSAL_DATE_KEYS)
}
