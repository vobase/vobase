/**
 * Frontmatter renderer shared by `/contacts/<id>/PROFILE.md` and
 * `/staff/<id>/PROFILE.md`. The body below the second `---` is the
 * auto-rendered identity heading; the frontmatter is read-only at the
 * workspace level (edits route through `vobase contacts propose-change`),
 * but the renderer still runs on every wake to give the agent a structured
 * view of the row.
 *
 * Render-twice byte-stability — sorted keys + canonical quoting keep the
 * output deterministic so the prompt-cache stays warm across wakes.
 */

import type { AttributeValue, Contact } from '@modules/contacts/schema'
import type { StaffProfile } from '@modules/team/schema'

type ParsedScalar = string | number | boolean | null
type ParsedValue = ParsedScalar | ParsedScalar[] | Record<string, ParsedScalar>

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

// ─── Internal helpers ───────────────────────────────────────────────────────

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
