/**
 * `vobase team set-attribute` — write a single attribute value onto a staff
 * profile. Mirrors the `/staff/:userId/attributes` PATCH handler (merge
 * semantics: only the keys passed are touched).
 *
 * Coerces the string `--value` flag to the type the attribute definition
 * declares (`text` / `number` / `boolean` / `date` / `enum`). Erroring on an
 * unknown key catches typos before they reach the JSONB column.
 */

import { listDefs } from '@modules/team/service/attribute-definitions'
import { setAttributes } from '@modules/team/service/staff'
import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

import type { AttributeValue } from '../schema'

const TRUE_TOKENS = new Set(['true', 'yes', 'y', '1', 'on'])
const FALSE_TOKENS = new Set(['false', 'no', 'n', '0', 'off'])

function coerce(
  raw: string,
  type: 'text' | 'number' | 'boolean' | 'date' | 'enum',
  options: readonly string[],
): { ok: true; value: AttributeValue } | { ok: false; error: string } {
  if (raw.toLowerCase() === 'null') return { ok: true, value: null }
  if (type === 'boolean') {
    const lower = raw.toLowerCase().trim()
    if (TRUE_TOKENS.has(lower)) return { ok: true, value: true }
    if (FALSE_TOKENS.has(lower)) return { ok: true, value: false }
    return { ok: false, error: `boolean attribute expects true/false/yes/no/1/0, got "${raw}"` }
  }
  if (type === 'number') {
    const n = Number(raw)
    if (!Number.isFinite(n)) return { ok: false, error: `number attribute expects a numeric value, got "${raw}"` }
    return { ok: true, value: n }
  }
  if (type === 'enum') {
    if (!options.includes(raw)) {
      return { ok: false, error: `enum attribute expects one of [${options.join(', ')}], got "${raw}"` }
    }
    return { ok: true, value: raw }
  }
  // text + date pass through as strings; the definition's own validation (if any) runs server-side.
  return { ok: true, value: raw }
}

export const teamSetAttributeVerb = defineCliVerb({
  name: 'team set-attribute',
  description:
    'Set a single attribute value on a staff profile. Coerces --value to the type declared by the attribute definition (boolean accepts true/false/yes/no/1/0).',
  usage: 'vobase team set-attribute --user=<userId> --key=<attrKey> --value=<v>',
  input: z.object({
    user: z.string().min(1),
    key: z.string().min(1),
    value: z.string(),
  }),
  body: async ({ ctx, input }) => {
    const defs = await listDefs(ctx.organizationId)
    const def = defs.find((d) => d.key === input.key)
    if (!def) {
      return {
        ok: false as const,
        error: `unknown attribute key "${input.key}". Known keys: ${defs.map((d) => d.key).join(', ') || '(none)'}`,
        errorCode: 'invalid_input' as const,
      }
    }
    const coerced = coerce(input.value, def.type, def.options)
    if (!coerced.ok) {
      return { ok: false as const, error: coerced.error, errorCode: 'invalid_input' as const }
    }
    try {
      const row = await setAttributes(input.user, { [input.key]: coerced.value })
      return {
        ok: true as const,
        data: { userId: row.userId, attributes: row.attributes },
        summary: `Set ${input.key}=${JSON.stringify(coerced.value)} on user:${input.user}.`,
      }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        errorCode: 'not_found' as const,
      }
    }
  },
  formatHint: 'json',
})
