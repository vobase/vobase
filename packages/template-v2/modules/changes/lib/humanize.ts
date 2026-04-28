/**
 * Human-readable labels and consequence sentences for change proposals.
 * Lives next to `summarize-payload.ts` so non-UI callers (CLI, agent tool
 * results) can reuse the same wording. Kept intentionally small — the goal
 * is for an SME owner reading "/changes" to see plain-English nouns and
 * verbs, never module/type tokens.
 */

import type { ChangePayload } from '@vobase/core'

import { pluralize } from '@/lib/format'
import type { ChangeProposalInboxItem } from '../schema'

const RESOURCE_KIND_LABELS: Record<string, string> = {
  'agents:agent': 'Agent definition',
  'agents:agent_memory': 'Agent memory',
  'agents:learned_skill': 'Agent skill',
  'agents:schedule': 'Agent schedule',
  'contacts:contact': 'Contact',
  'drive:doc': 'Document',
  'drive:file': 'File',
  'messaging:label': 'Conversation label',
}

/**
 * Headline shape for `/changes` rows. The UI swaps a static "Module Type: id"
 * label for a context-aware sentence — e.g. an agent's own memory edit reads
 * "Sentinel wants to update their own Memory" and a contact edit collapses to
 * just the contact's name. The render layer resolves principal tokens through
 * `usePrincipalDirectory`.
 *
 * Variants:
 *   - `owned-resource` — resource belongs to a principal we can name (memory,
 *     skill). Owner avatar precedes a possessive label, then an optional name
 *     (skill slug). Memory has no name; only the owner.
 *   - `principal`     — the resource IS a principal (an agent or contact
 *     definition). Render the principal's avatar + name only; no kind word.
 *   - `plain`         — drive docs, files, labels: a kind label + name.
 */
export type HeadlineParts =
  | { kind: 'owned-resource'; ownerToken: string; ownerLabel: string; resourceName: string | null }
  | { kind: 'principal'; principalToken: string }
  | { kind: 'plain'; kindLabel: string; resourceName: string }

export function getHeadlineParts(proposal: ChangeProposalInboxItem): HeadlineParts {
  const { resourceModule, resourceType, resourceId, proposedById, proposedByKind } = proposal
  const key = `${resourceModule}:${resourceType}`
  switch (key) {
    case 'agents:agent_memory':
      // Memory is per-agent; the resource id IS the agent id. Drop the id from
      // the visible label — "Sentinel's Memory" is enough since each agent has
      // exactly one memory store.
      return { kind: 'owned-resource', ownerToken: `agent:${resourceId}`, ownerLabel: 'Memory', resourceName: null }
    case 'agents:learned_skill':
      // Skill slug stays useful (e.g. "escalate-vip-when-stuck"). Owning agent
      // isn't encoded in resource id, so use the proposer when it's an agent;
      // staff-proposed skill edits fall back to the headline-less plain form.
      if (proposedByKind === 'agent') {
        return { kind: 'owned-resource', ownerToken: proposedById, ownerLabel: 'Skill', resourceName: resourceId }
      }
      return { kind: 'plain', kindLabel: 'Agent skill', resourceName: resourceId }
    case 'agents:agent':
      return { kind: 'principal', principalToken: `agent:${resourceId}` }
    case 'contacts:contact':
      return { kind: 'principal', principalToken: `contact:${resourceId}` }
    case 'drive:doc':
    case 'drive:file': {
      const basename = resourceId.split('/').filter(Boolean).pop()?.replace(/\.md$/i, '') ?? resourceId
      return { kind: 'plain', kindLabel: key === 'drive:doc' ? 'Document' : 'File', resourceName: basename }
    }
    default:
      return {
        kind: 'plain',
        kindLabel: humanizeResourceKind(resourceModule, resourceType),
        resourceName: resourceId,
      }
  }
}

/** Plain-English noun for a `(module, type)` pair, e.g. "Agent memory". Falls
 *  back to a title-cased pair so unknown kinds still read sensibly. */
export function humanizeResourceKind(module: string, type: string): string {
  return RESOURCE_KIND_LABELS[`${module}:${type}`] ?? titleCase(`${module} ${type}`)
}

/** Strip path/extension noise from a resource id so the headline shows the
 *  shortest meaningful name. Drive paths become their basename without `.md`;
 *  everything else is returned as-is (memory keys, contact emails, etc.). */
export function humanizeResourceId(module: string, resourceId: string): string {
  if (module === 'drive') {
    const last = resourceId.split('/').filter(Boolean).pop() ?? resourceId
    return last.replace(/\.md$/i, '')
  }
  return resourceId
}

/** One-line "what happens if you approve this" sentence, kind-aware. The
 *  resource label should already be lowercased (e.g. "agent memory"). */
export function consequenceFor(payload: ChangePayload, resourceLabel: string): string {
  const noun = resourceLabel.toLowerCase()
  if (payload.kind === 'markdown_patch') {
    if (payload.mode === 'append') {
      return `New content will be appended to this ${noun}. Agents will reference the updated version in future replies.`
    }
    return `This ${noun} will be replaced with the proposed content. Agents will reference the new version immediately.`
  }
  if (payload.kind === 'field_set') {
    const n = Object.keys(payload.fields).length
    return `${pluralize(n, 'field')} on this ${noun} will be updated.`
  }
  const n = payload.ops.length
  return `${pluralize(n, 'change')} will be applied to this ${noun}.`
}

function titleCase(s: string): string {
  return s
    .split(/[\s_-]+/)
    .map((w) => (w.length === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}
