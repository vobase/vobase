/**
 * Auto-derive a `vobase <verb-name> --field=<…>` usage line from a Zod input
 * schema. Replaces hand-typed `usage` strings for verbs whose argument shape
 * is precise enough that Zod can describe it.
 *
 * What we render per field:
 *   - `z.string()`              → `<string>`
 *   - `z.number()` / int        → `<number>` / `<integer>`
 *   - `z.boolean()`             → boolean flag (`--flag`, no value)
 *   - `z.literal('x')`          → `<x>`
 *   - `z.enum(['a', 'b', 'c'])` → `<a|b|c>`
 *   - `z.union([z.literal(...)])` (literal-only union) → `<a|b|c>`
 *   - `z.array(<inner>)`        → `<a,…>` (the bash dispatcher splits on commas)
 *   - everything else           → `<value>`
 *
 * Optional fields (`.optional()`, `.default()`, `.nullable()`) are wrapped in
 * `[...]`. `.refine()` is a Zod v4 *check*, not a wrapper — refined strings
 * stay `_def.type === 'string'` and still render as `<string>`.
 *
 * Hand-overrides still win: `defineCliVerb({ usage: '...' })` skips this
 * helper entirely. Use overrides only when the structural derivation can't
 * express the constraint (e.g. `--to=<user:<id>|agent:<id>|unassigned>` —
 * a `.refine`-driven format spec can't be reverse-engineered from the schema).
 */

import type { z } from 'zod'

interface FieldDescriptor {
  name: string
  optional: boolean
  /** The rendered placeholder (or `null` for boolean flags that take no value). */
  placeholder: string | null
}

export function deriveUsage(verbName: string, schema: z.ZodType<unknown>): string {
  const fields = describeObject(schema)
  if (fields.length === 0) return `vobase ${verbName}`
  const parts = fields.map(renderField)
  return `vobase ${verbName} ${parts.join(' ')}`
}

function renderField(f: FieldDescriptor): string {
  if (f.placeholder === null) {
    return f.optional ? `[--${f.name}]` : `--${f.name}`
  }
  const core = `--${f.name}=${f.placeholder}`
  return f.optional ? `[${core}]` : core
}

/** Walk a `z.object({...})` schema. */
function describeObject(schema: z.ZodType<unknown>): FieldDescriptor[] {
  // biome-ignore lint/suspicious/noExplicitAny: zod runtime introspection requires loose access on `_def`
  const root = schema as any
  if (root?._def?.type !== 'object') return []
  const shape = root.shape ?? {}
  const out: FieldDescriptor[] = []
  for (const [name, def] of Object.entries(shape)) {
    out.push({
      name,
      optional: isOptional(def),
      placeholder: renderType(unwrapWrappers(def)),
    })
  }
  return out
}

const WRAPPER_TYPES = new Set(['optional', 'default', 'nullable'])

// biome-ignore lint/suspicious/noExplicitAny: zod runtime introspection — see deriveUsage docs
function unwrapWrappers(node: any): any {
  let cur = node
  while (cur?._def && WRAPPER_TYPES.has(cur._def.type)) {
    cur = cur._def.innerType
  }
  return cur
}

// biome-ignore lint/suspicious/noExplicitAny: zod runtime introspection — see deriveUsage docs
function isOptional(node: any): boolean {
  return Boolean(node?._def && WRAPPER_TYPES.has(node._def.type))
}

/** Render a non-wrapper Zod node as a `<...>` placeholder. Returns `null`
 *  for booleans (they render as bare `--flag`s). */
// biome-ignore lint/suspicious/noExplicitAny: zod runtime introspection — see deriveUsage docs
function renderType(node: any): string | null {
  const tn = node?._def?.type
  if (!tn) return '<value>'
  if (tn === 'boolean') return null
  if (tn === 'number') {
    const isInt = node._def.checks?.some((c: { _def?: { format?: string } }) => c._def?.format === 'safeint')
    return `<${isInt ? 'integer' : 'number'}>`
  }
  if (tn === 'string') return '<string>'
  if (tn === 'literal') {
    const values: readonly unknown[] = node._def.values ?? []
    return values.length > 0 ? `<${values.map(String).join('|')}>` : '<value>'
  }
  if (tn === 'enum') {
    const entries = node._def.entries ?? {}
    const values = Object.values(entries).map(String)
    return values.length > 0 ? `<${values.join('|')}>` : '<value>'
  }
  if (tn === 'union') {
    const opts = (node._def.options ?? []) as unknown[]
    const literals = opts.map(extractLiteral).filter((v): v is string => v !== null)
    if (literals.length > 0 && literals.length === opts.length) {
      return `<${literals.join('|')}>`
    }
    return '<value>'
  }
  if (tn === 'array') {
    const inner = renderType(unwrapWrappers(node._def.element))
    const innerLabel = inner === null ? 'value' : inner.replace(/^<|>$/g, '')
    return `<${innerLabel},…>`
  }
  return '<value>'
}

// biome-ignore lint/suspicious/noExplicitAny: zod runtime introspection — see deriveUsage docs
function extractLiteral(node: any): string | null {
  const inner = unwrapWrappers(node)
  if (inner?._def?.type !== 'literal') return null
  const values: readonly unknown[] = inner._def.values ?? []
  return values.length === 1 ? String(values[0]) : null
}
