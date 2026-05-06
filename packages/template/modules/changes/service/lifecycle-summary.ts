/**
 * Backend-safe one-line summary for `change.*` lifecycle journal events.
 *
 * The activity timeline (and any other consumer that watches
 * `harness.conversation_events`) needs a short label suitable for inline
 * rendering — the proposal's `rationale` is too long for that surface
 * (it's an SME-friendly paragraph, not a list-row title).
 *
 * Examples produced:
 *   - "Email change to marc@example.com"      (one scalar string field)
 *   - "Display name change to Marc K. Chen"   (one scalar string field)
 *   - "Marketing opt-out set to Yes"          (boolean scalar)
 *   - "Email and phone change"                (two fields)
 *   - "3 contact fields updated"              (3+ fields)
 *   - "Memory note appended"                  (markdown_patch append)
 *   - "Document rewritten"                    (markdown_patch replace)
 *   - "Contact update"                        (fallback)
 *
 * The output is plain prose, capped at ~80 chars by the value-truncation
 * helper. Frontend consumers MUST treat it as already-formatted text.
 */

import type { ChangePayload } from '@vobase/core'

const SCALAR_LABELS: Readonly<Record<string, string>> = {
  displayName: 'Display name',
  email: 'Email',
  phone: 'Phone',
  segments: 'Segments',
  marketingOptOut: 'Marketing opt-out',
  title: 'Title',
  availability: 'Availability',
  capacity: 'Capacity',
  expertise: 'Expertise',
  sectors: 'Sectors',
  languages: 'Languages',
}

const RESOURCE_NOUNS: Readonly<Record<string, string>> = {
  'contacts:contact': 'contact',
  'agents:agent': 'agent',
  'agents:agent_memory': 'agent memory',
  'agents:learned_skill': 'agent skill',
  'agents:schedule': 'agent schedule',
  'drive:doc': 'document',
  'drive:file': 'file',
  'team:staff': 'staff member',
  'messaging:label': 'conversation label',
}

export interface SummarizeOpts {
  payload: ChangePayload
  resourceModule: string
  resourceType: string
}

export function summarizeLifecycleEvent(opts: SummarizeOpts): string {
  const noun = RESOURCE_NOUNS[`${opts.resourceModule}:${opts.resourceType}`] ?? `${opts.resourceModule} record`
  const p = opts.payload
  if (p.kind === 'field_set') return summarizeFieldSet(p.fields, noun)
  if (p.kind === 'markdown_patch') return summarizeMarkdownPatch(p, noun)
  return `${capitalize(noun)} update`
}

function summarizeFieldSet(fields: Record<string, { from?: unknown; to?: unknown }>, noun: string): string {
  const entries = Object.entries(fields)
  if (entries.length === 0) return `${capitalize(noun)} update`

  if (entries.length === 1) {
    const [key, change] = entries[0]
    const label = humanFieldLabel(key)
    const value = formatScalarValue(change.to)
    if (value === null) return `${label} update`
    if (key === 'marketingOptOut') return `${label} set to ${value}`
    return `${label} change to ${value}`
  }

  if (entries.length === 2) {
    const [a, b] = entries.map(([k]) => humanFieldLabel(k).toLowerCase())
    return `${capitalize(a)} and ${b} change`
  }

  return `${entries.length} ${noun} fields updated`
}

function summarizeMarkdownPatch(patch: Extract<ChangePayload, { kind: 'markdown_patch' }>, noun: string): string {
  if (noun.endsWith('memory') && patch.mode === 'append') return 'Memory note appended'
  if (noun.endsWith('memory') && patch.mode === 'replace') return 'Memory rewritten'
  if (patch.mode === 'append') return `${capitalize(noun)} appended`
  return `${capitalize(noun)} rewritten`
}

function humanFieldLabel(key: string): string {
  if (key.startsWith('attributes.')) {
    const attr = key.slice('attributes.'.length)
    return humanise(attr)
  }
  return SCALAR_LABELS[key] ?? humanise(key)
}

function humanise(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
  if (!spaced) return key
  return capitalize(spaced.toLowerCase())
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)
}

const VALUE_MAX = 60

function formatScalarValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return 'empty'
    const joined = value.map(String).join(', ')
    return joined.length > VALUE_MAX ? `${joined.slice(0, VALUE_MAX - 1)}…` : joined
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) return null
    return trimmed.length > VALUE_MAX ? `${trimmed.slice(0, VALUE_MAX - 1)}…` : trimmed
  }
  return null
}
