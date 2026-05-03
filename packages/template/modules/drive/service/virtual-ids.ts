/**
 * Virtual drive-file id parser/formatter.
 *
 * Drive synthesizes "virtual" file rows that have no `drive_files` backing row.
 * Their `id` field follows one of two shapes:
 *
 *   - `virtual:<backingScope>:<scopeIdVal>:<field>` — built-in inline overlay
 *     (contact/staff: PROFILE.md / MEMORY.md; agent: AGENTS.md / MEMORY.md),
 *     backed by a column on the owner table.
 *   - `virtual:provider:<providerId>:<scopeIdVal>:<key>` — registry-driven
 *     overlay contributed by an owner module via `registerDriveOverlay()`.
 *
 * `parseVirtualId` returns a discriminated union; callers MUST check `kind`.
 * Returns `null` on shape mismatch — never throws, never casts.
 */

import { z } from 'zod'

export type VirtualBackingScope = 'contact' | 'staff' | 'agent'
export type VirtualField = 'profile' | 'memory' | 'instructions'

export type VirtualId =
  | { kind: 'builtin'; backingScope: VirtualBackingScope; scopeIdVal: string; field: VirtualField }
  | { kind: 'provider'; providerId: string; scopeIdVal: string; key: string }

const backingScopeSchema = z.enum(['contact', 'staff', 'agent'])
const fieldSchema = z.enum(['profile', 'memory', 'instructions'])

const builtinSchema = z.object({
  backingScope: backingScopeSchema,
  scopeIdVal: z.string().min(1),
  field: fieldSchema,
})

const providerSchema = z.object({
  providerId: z.string().min(1),
  scopeIdVal: z.string().min(1),
  key: z.string().min(1),
})

/**
 * Parse a virtual drive-file id. Returns `null` on shape mismatch (no throws,
 * no `as` casts).
 *
 * Provider ids are encoded as the literal segment `provider` followed by the
 * provider's own id (which may itself contain a `/` like `agents/skills`),
 * the scope-id value, and a provider-defined key. Because provider ids may
 * contain `:`, the `key` segment is the rest of the string after we strip the
 * fixed prefix.
 */
/** Cheap check used by UI gates that don't need to parse the body. */
export function isVirtualId(id: string): boolean {
  return id.startsWith('virtual:')
}

export function parseVirtualId(id: string): VirtualId | null {
  if (!isVirtualId(id)) return null
  const rest = id.slice('virtual:'.length)

  // Provider form: provider:<providerId>:<scopeIdVal>:<key>
  // providerId is the canonical 'agents/skills' shape (no colons), scopeIdVal
  // is a nanoid (no colons), key may contain anything the provider chose.
  if (rest.startsWith('provider:')) {
    const after = rest.slice('provider:'.length)
    const firstColon = after.indexOf(':')
    if (firstColon < 1) return null
    const providerId = after.slice(0, firstColon)
    const tail = after.slice(firstColon + 1)
    const secondColon = tail.indexOf(':')
    if (secondColon < 1) return null
    const scopeIdVal = tail.slice(0, secondColon)
    const key = tail.slice(secondColon + 1)
    if (key.length === 0) return null
    const parsed = providerSchema.safeParse({ providerId, scopeIdVal, key })
    if (!parsed.success) return null
    return { kind: 'provider', ...parsed.data }
  }

  // Builtin form: <backingScope>:<scopeIdVal>:<field>
  const parts = rest.split(':')
  if (parts.length !== 3) return null
  const [backingScope, scopeIdVal, field] = parts
  const parsed = builtinSchema.safeParse({ backingScope, scopeIdVal, field })
  if (!parsed.success) return null
  return { kind: 'builtin', ...parsed.data }
}

export function formatBuiltinId(scope: VirtualBackingScope, scopeId: string, field: VirtualField): string {
  return `virtual:${scope}:${scopeId}:${field}`
}

export function formatProviderId(providerId: string, scopeId: string, key: string): string {
  return `virtual:provider:${providerId}:${scopeId}:${key}`
}
