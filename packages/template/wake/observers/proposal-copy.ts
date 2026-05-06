/**
 * Builds human-readable `rationale` + `expectedOutcome` copy for change
 * proposals coming out of the wake observers. The audit inbox is read by
 * non-technical SME staff, so the prose has to name the subject, list the
 * actual edits, and stay clear of harness jargon ("frontmatter", "field_set",
 * "row", "supervisor wake").
 *
 * Two surfaces today:
 *   - `buildFieldSetCopy`        — frontmatter `field_set` proposals from
 *                                   `workspace-sync`. Renders one bullet per
 *                                   changed key with the human label, the new
 *                                   value, and the prior value when present.
 *   - `buildStaffSignalCopy`     — `agent_memory` proposals from
 *                                   `learning-proposals`. Names the staff
 *                                   author and quotes their note.
 *
 * Async loaders pull `attribute_definitions` for the org so `attributes.<key>`
 * keys render with their human label and type-aware formatting (dates, enums).
 * Loaders are best-effort; on failure we fall back to a humanised key.
 */

import { listDefs as listContactAttrDefs } from '@modules/contacts/service/attribute-definitions'
import { listDefs as listStaffAttrDefs } from '@modules/team/service/attribute-definitions'

import { ORG_TIMEZONE } from '~/runtime/tz'
import type { FieldDiff } from '../profile-frontmatter'

export type AttrType = 'text' | 'number' | 'boolean' | 'date' | 'enum'

export interface AttrLabel {
  label: string
  type: AttrType
}

/** Map of attribute key (without `attributes.` prefix) to human label + type. */
export type AttrLabelMap = ReadonlyMap<string, AttrLabel>

const SCALAR_LABELS: Readonly<Record<string, string>> = {
  displayName: 'Name',
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

const ARRAY_SCALARS = new Set(['segments', 'expertise', 'sectors', 'languages'])
const BOOLEAN_SCALARS = new Set(['marketingOptOut'])
const NUMBER_SCALARS = new Set(['capacity'])

export async function loadContactAttrLabels(organizationId: string): Promise<AttrLabelMap> {
  const defs = await listContactAttrDefs(organizationId).catch(() => [])
  const out = new Map<string, AttrLabel>()
  for (const d of defs) out.set(d.key, { label: d.label, type: d.type })
  return out
}

export async function loadStaffAttrLabels(organizationId: string): Promise<AttrLabelMap> {
  const defs = await listStaffAttrDefs(organizationId).catch(() => [])
  const out = new Map<string, AttrLabel>()
  for (const d of defs) out.set(d.key, { label: d.label, type: d.type })
  return out
}

export interface BuildFieldSetCopyOpts {
  /** Display label for the subject (e.g. "Marcus Quasar"). */
  subjectName: string
  /** Singular noun for the subject in possessive prose. */
  subjectNoun: 'contact' | 'staff member'
  /** Friendly agent name surfaced in the rationale. Falls back to "The agent". */
  agentName?: string
  fields: Record<string, FieldDiff>
  /** Resource-level approval gate (true means every change queues). */
  requiresApproval: boolean
  /** Per-field gate set; if any of these top-level keys appears in `fields`, the whole batch queues. */
  requiresApprovalForFields?: ReadonlySet<string>
  /** Attribute definitions for `attributes.<key>` lookups. Optional — falls back to humanised keys. */
  attrLabels?: AttrLabelMap
}

export interface ProposalCopy {
  rationale: string
  expectedOutcome: string
}

export function buildFieldSetCopy(opts: BuildFieldSetCopyOpts): ProposalCopy {
  const agent = opts.agentName?.trim() || 'The agent'
  const entries = Object.entries(opts.fields)
  const count = entries.length
  const detailWord = count === 1 ? 'detail' : 'details'

  const gatedFields = opts.requiresApprovalForFields ?? new Set<string>()
  const queuesForFieldGate = entries.some(([k]) => gatedFields.has(k))
  const willQueue = opts.requiresApproval || queuesForFieldGate

  const lead = `${agent} picked up ${count} new ${detailWord} about ${opts.subjectName} during the conversation.`
  const tail = willQueue
    ? queuesForFieldGate && !opts.requiresApproval
      ? ' One or more of the changes touch sensitive fields, so the batch needs your sign-off.'
      : ' Changes to staff records always need your sign-off.'
    : ''
  const rationale = `${lead}${tail}`

  const verb = willQueue ? 'If you approve, we will save' : 'Saved'
  const possessive = `${opts.subjectName}’s ${opts.subjectNoun} profile`
  const bullets = entries.map(([key, diff]) => `• ${formatBullet(key, diff, opts.attrLabels)}`).join('\n')
  const expectedOutcome = `${verb} the following on ${possessive}:\n${bullets}`

  return { rationale, expectedOutcome }
}

export interface BuildStaffSignalCopyOpts {
  agentName?: string
  signalKind: 'supervisor' | 'approval_rejected' | 'internal_note' | 'reassignment_note'
  /** Resolved actor name (e.g. "Bob"). Falls back to "A teammate" when unknown. */
  actorName?: string
  /** Short prose preview of the originating note (already capped upstream). */
  notePreview?: string
}

export function buildStaffSignalCopy(opts: BuildStaffSignalCopyOpts): ProposalCopy {
  const agent = opts.agentName?.trim() || 'The agent'
  const actor = opts.actorName?.trim() || 'A teammate'

  const lead =
    opts.signalKind === 'supervisor'
      ? `${actor} pinged ${agent} with a coaching note in this conversation.`
      : opts.signalKind === 'approval_rejected'
        ? `${actor} rejected an action ${agent} proposed.`
        : opts.signalKind === 'reassignment_note'
          ? `${actor} reassigned this conversation and left a note for ${agent}.`
          : `${actor} left ${agent} an internal note in this conversation.`

  const rationale = `${lead} Filing it as a lesson so ${agent} remembers it next time.`

  const note = opts.notePreview?.trim()
  const quote = note ? `\n\n“${note}”` : ''
  const expectedOutcome = `${agent} will keep this in mind on future conversations.${quote}`

  return { rationale, expectedOutcome }
}

// ─── Bullet formatting ───────────────────────────────────────────────────────

function formatBullet(key: string, diff: FieldDiff, labels: AttrLabelMap | undefined): string {
  const label = humanLabel(key, labels)
  const type = inferType(key, labels)
  const to = formatValue(diff.to, type)
  const from = formatValue(diff.from, type)
  if (isEmpty(diff.from)) return `${label}: ${to}`
  return `${label}: ${to} (was ${from})`
}

function humanLabel(key: string, labels: AttrLabelMap | undefined): string {
  if (key.startsWith('attributes.')) {
    const attrKey = key.slice('attributes.'.length)
    const def = labels?.get(attrKey)
    if (def) return def.label
    return humaniseKey(attrKey)
  }
  return SCALAR_LABELS[key] ?? humaniseKey(key)
}

function humaniseKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
  if (!spaced) return key
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
}

type FormattableType = AttrType | 'array' | 'unknown'

function inferType(key: string, labels: AttrLabelMap | undefined): FormattableType {
  if (ARRAY_SCALARS.has(key)) return 'array'
  if (BOOLEAN_SCALARS.has(key)) return 'boolean'
  if (NUMBER_SCALARS.has(key)) return 'number'
  if (key.startsWith('attributes.')) {
    const def = labels?.get(key.slice('attributes.'.length))
    if (def) return def.type
  }
  return 'unknown'
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (Array.isArray(v) && v.length === 0) return true
  if (typeof v === 'string' && v.trim() === '') return true
  return false
}

function formatValue(value: unknown, type: FormattableType): string {
  if (value === null || value === undefined) return '—'
  if (type === 'array' || Array.isArray(value)) {
    if (!Array.isArray(value) || value.length === 0) return '—'
    return value.map(String).join(', ')
  }
  if (type === 'boolean' || typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }
  if (type === 'date' && typeof value === 'string') {
    return formatDate(value)
  }
  if (typeof value === 'string') {
    if (looksLikeDate(value)) return formatDate(value)
    return value
  }
  if (typeof value === 'number') return String(value)
  return JSON.stringify(value)
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

function looksLikeDate(s: string): boolean {
  return DATE_ONLY_RE.test(s) || ISO_DATETIME_RE.test(s)
}

function formatDate(iso: string): string {
  if (DATE_ONLY_RE.test(iso)) {
    const [y, m, d] = iso.split('-').map(Number)
    if (!y || !m || !d) return iso
    const date = new Date(Date.UTC(y, m - 1, d))
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date)
  }
  if (ISO_DATETIME_RE.test(iso)) {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return iso
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: ORG_TIMEZONE,
    }).format(date)
  }
  return iso
}
