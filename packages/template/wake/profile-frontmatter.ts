/**
 * Frontmatter renderer + parser shared by `/contacts/<id>/profile.md` and
 * `/staff/<id>/profile.md`. The frontmatter is the agent's structured-edit
 * surface; the body is the auto-rendered identity heading.
 *
 * Two correctness requirements:
 * 1. Render-twice byte-stability — sorted keys + canonical quoting keep the
 *    diff honest and prevent no-op proposals on every wake.
 * 2. No type coercion on parse — we use Bun's YAML 1.2 default (date
 *    strings stay strings) and additionally reject `Date` instances in
 *    `coerceScalar` so a future Bun upgrade can't silently regress.
 */

import type { AttributeValue, Contact } from '@modules/contacts/schema'
import type { StaffProfile } from '@modules/team/schema'

/**
 * Parsed frontmatter as a flat record. Top-level keys are scalars or arrays;
 * `attributes` if present is a nested record whose values are scalars or null.
 * The parser guarantees no `Date` objects or other auto-coerced types reach
 * the diff layer — every value is a string, number, boolean, array of those,
 * a nested record (only at `attributes`), or null.
 */
export type ParsedScalar = string | number | boolean | null
export type ParsedValue = ParsedScalar | ParsedScalar[] | Record<string, ParsedScalar>

export interface ParsedProfile {
  [key: string]: ParsedValue | undefined
  attributes?: Record<string, ParsedScalar>
}

export interface FieldDiff {
  from: unknown
  to: unknown
}

export interface ProfileDiff {
  fields: Record<string, FieldDiff>
}

// ─── Renderers ──────────────────────────────────────────────────────────────

/**
 * Render a contact row's frontmatter. Includes only fields that live on the
 * contact row (no joined columns). Null / empty-string / empty-array values
 * are omitted.
 */
export function renderContactFrontmatter(c: Contact): string {
  const fields: Record<string, ParsedValue> = {}
  if (nonEmptyString(c.displayName)) fields.displayName = c.displayName
  if (nonEmptyString(c.email)) fields.email = c.email
  if (nonEmptyString(c.phone)) fields.phone = c.phone
  if (c.segments.length > 0) fields.segments = [...c.segments]
  fields.marketingOptOut = c.marketingOptOut
  const attributes = sortedAttributeMap(c.attributes)
  if (attributes) fields.attributes = attributes
  return emitFrontmatter(fields)
}

/**
 * Render a staff profile's frontmatter. v1 omits `email` (lives in
 * `auth.user`, not on `staff_profiles`); when the email column is lifted onto
 * the staff row a follow-up adds it here. `displayName`, `title`,
 * `availability`, `capacity`, `expertise`, `sectors`, `languages`, and
 * `attributes.*` are emitted with the same null/empty-omission rules as
 * contacts.
 */
export function renderStaffFrontmatter(p: StaffProfile): string {
  const fields: Record<string, ParsedValue> = {}
  if (nonEmptyString(p.displayName)) fields.displayName = p.displayName
  if (nonEmptyString(p.title)) fields.title = p.title
  fields.availability = p.availability
  fields.capacity = p.capacity
  if (p.expertise.length > 0) fields.expertise = [...p.expertise]
  if (p.sectors.length > 0) fields.sectors = [...p.sectors]
  if (p.languages.length > 0) fields.languages = [...p.languages]
  const attributes = sortedAttributeMap(p.attributes)
  if (attributes) fields.attributes = attributes
  return emitFrontmatter(fields)
}

// ─── Parser ─────────────────────────────────────────────────────────────────

/**
 * Parse a profile.md body into a `ParsedProfile`. Returns `null` for missing
 * delimiters, malformed YAML, or non-map root. Date strings stay as strings
 * (YAML 1.2 default in Bun). The returned record carries only top-level keys
 * the YAML actually defined — absent keys are absent (distinct from explicit
 * `null` which the diff layer treats as "set to null").
 */
export function parseFrontmatter(body: string): ParsedProfile | null {
  const split = splitDelimiters(body)
  if (!split) return null
  let raw: unknown
  try {
    raw = Bun.YAML.parse(split.frontmatter)
  } catch {
    return null
  }
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const result: ParsedProfile = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === 'attributes') {
      if (value == null) {
        result.attributes = undefined
        continue
      }
      if (typeof value !== 'object' || Array.isArray(value)) continue
      const attrs: Record<string, ParsedScalar> = {}
      for (const [ak, av] of Object.entries(value as Record<string, unknown>)) {
        const scalar = coerceScalar(av)
        if (scalar !== UNSUPPORTED) attrs[ak] = scalar
      }
      result.attributes = attrs
      continue
    }
    const v = coerceValue(value)
    if (v !== UNSUPPORTED) result[key] = v
  }
  return result
}

// ─── Diff ───────────────────────────────────────────────────────────────────

/**
 * Compare two parsed profiles and return the set of field deltas the agent
 * intends to commit. Walks `current`'s keys only — keys absent from `current`
 * are treated as no-ops, not as deletions, so unrelated UI edits to other
 * keys in the baseline are preserved across wakes. Explicit `null` in
 * `current` against a non-null baseline produces `{ from, to: null }`,
 * letting the agent intentfully clear a field. `attributes.*` keys are
 * flattened with a literal dot prefix so the materializer's per-field gate
 * sees one key per attribute rather than the wrapping map.
 */
export function diffProfile(baseline: ParsedProfile, current: ParsedProfile): ProfileDiff {
  const fields: Record<string, FieldDiff> = {}
  for (const key of Object.keys(current)) {
    if (key === 'attributes') continue
    const to = current[key] ?? null
    const from = baseline[key] ?? null
    if (!valueEquals(from, to)) fields[key] = { from, to }
  }
  if (current.attributes) {
    const base = baseline.attributes ?? {}
    for (const ak of Object.keys(current.attributes)) {
      const to = current.attributes[ak] ?? null
      const from = base[ak] ?? null
      if (!valueEquals(from, to)) fields[`attributes.${ak}`] = { from, to }
    }
  }
  return { fields }
}

// ─── Internal helpers ───────────────────────────────────────────────────────

const UNSUPPORTED = Symbol('unsupported-yaml-value')

function nonEmptyString(s: string | null | undefined): s is string {
  return typeof s === 'string' && s.length > 0
}

function sortedAttributeMap(attrs: Record<string, AttributeValue> | undefined): Record<string, ParsedScalar> | null {
  if (!attrs) return null
  const keys = Object.keys(attrs)
  if (keys.length === 0) return null
  keys.sort()
  const out: Record<string, ParsedScalar> = {}
  for (const k of keys) out[k] = attrs[k] ?? null
  return out
}

function emitFrontmatter(fields: Record<string, ParsedValue>): string {
  const keys = Object.keys(fields).sort()
  const lines: string[] = ['---']
  for (const k of keys) lines.push(emitField(k, fields[k] as ParsedValue, 0))
  lines.push('---', '')
  return `${lines.join('\n')}\n`
}

function emitField(key: string, value: ParsedValue, indent: number): string {
  const pad = '  '.repeat(indent)
  if (Array.isArray(value)) {
    return `${pad}${key}: ${emitArray(value)}`
  }
  if (isPlainObject(value)) {
    const inner = Object.keys(value).sort()
    if (inner.length === 0) return `${pad}${key}: {}`
    const sub = inner.map((k) => emitField(k, value[k] as ParsedScalar, indent + 1)).join('\n')
    return `${pad}${key}:\n${sub}`
  }
  return `${pad}${key}: ${emitScalar(value)}`
}

function emitArray(arr: ParsedScalar[]): string {
  return `[${arr.map(emitScalar).join(', ')}]`
}

function emitScalar(v: ParsedScalar): string {
  if (v === null) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null'
  return quoteString(v)
}

function quoteString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function isPlainObject(v: unknown): v is Record<string, ParsedScalar> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function coerceValue(v: unknown): ParsedValue | typeof UNSUPPORTED {
  if (Array.isArray(v)) {
    const out: ParsedScalar[] = []
    for (const item of v) {
      const s = coerceScalar(item)
      if (s === UNSUPPORTED) return UNSUPPORTED
      out.push(s)
    }
    return out
  }
  return coerceScalar(v)
}

function coerceScalar(v: unknown): ParsedScalar | typeof UNSUPPORTED {
  if (v === null) return null
  if (typeof v === 'string') return v
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean') return v
  if (v instanceof Date) return v.toISOString()
  return UNSUPPORTED
}

function valueEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return a === b
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!valueEquals(a[i], b[i])) return false
    return true
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ak = Object.keys(a).sort()
    const bk = Object.keys(b).sort()
    if (ak.length !== bk.length) return false
    for (let i = 0; i < ak.length; i++) {
      if (ak[i] !== bk[i]) return false
      if (!valueEquals(a[ak[i] as string], b[bk[i] as string])) return false
    }
    return true
  }
  return false
}

interface FrontmatterSplit {
  frontmatter: string
  body: string
}

function splitDelimiters(content: string): FrontmatterSplit | null {
  if (!content.startsWith('---')) return null
  const after = content.slice(3)
  const stripped = after.replace(/^\r?\n/, '')
  const closingIdx = stripped.indexOf('\n---')
  if (closingIdx === -1) return null
  const frontmatter = stripped.slice(0, closingIdx)
  const rest = stripped.slice(closingIdx + 4).replace(/^\r?\n/, '')
  return { frontmatter, body: rest }
}
