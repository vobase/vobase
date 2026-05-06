/**
 * createWorkspaceSyncListener — on `agent_end`, flushes the dirty-tracker
 * buffer and persists writable-zone changes to their owning module services.
 *
 * Routing rules:
 *   `/agents/<id>/MEMORY.md`      → drive.writePath({scope:'agent'})  (virtual column on agent_definitions)
 *   `/contacts/<id>/MEMORY.md`    → drive.writePath({scope:'contact'}) (virtual column on contacts)
 *   `/contacts/<id>/profile.md`   → insertProposal({field_set})  (frontmatter diff against current row)
 *   `/staff/<id>/profile.md`      → insertProposal({field_set})  (resource-level requiresApproval=true)
 *   `/contacts/<id>/drive/**`     → FilesService.create / delete  (scope='contact')
 *   `/staff/<staffId>/MEMORY.md`  → upsertStaffMemory(org, agent, staff)
 *
 * Profile.md frontmatter is the agent's structured-edit surface. The observer
 * re-reads the row, parses both baseline and current with `parseFrontmatter`,
 * computes a `field_set` diff, and submits one `insertProposal`. Auto-apply
 * vs. queue is decided by the change-proposals registry (`requiresApproval`
 * and the per-field gate).
 *
 * Frozen-snapshot invariant: this listener ONLY fires on `agent_end`.
 * Mid-wake dirty writes accumulate in the tracker but are NOT flushed until then,
 * so the current turn's frozen side-load never sees its own writes.
 */

import { upsertStaffMemory } from '@modules/agents/service/staff-memory'
import { insertProposal } from '@modules/changes/service/proposals'
import { CONTACT_RESOURCE, CONTACT_SCALAR_FIELDS } from '@modules/contacts/service/changes'
import { get as getContact } from '@modules/contacts/service/contacts'
import type { FilesService } from '@modules/drive/service/files'
import type { CreateFileInput, DriveScope } from '@modules/drive/service/types'
import { staff as staffService } from '@modules/team/service'
import { STAFF_RESOURCE, STAFF_SCALAR_FIELDS } from '@modules/team/service/changes'
import type { StaffProfileLookup } from '@modules/team/service/types'
import type { ChangePayload, DirtyDiff, DirtyTracker, HarnessLogger } from '@vobase/core'
import type { IFileSystem } from 'just-bash'

import type { RealtimeService } from '~/runtime'
import type { AgentEvent } from '../events'
import { stripBudgetHeader } from '../memory-budget'
import {
  diffProfile,
  type FieldDiff,
  type ParsedProfile,
  parseFrontmatter,
  renderContactFrontmatter,
  renderStaffFrontmatter,
} from '../profile-frontmatter'
import { CONTACT_GATED_FIELDS, STAFF_GATED_FIELDS } from './gated-fields'
import { type AttrLabelMap, buildFieldSetCopy, loadContactAttrLabels, loadStaffAttrLabels } from './proposal-copy'

export interface WorkspaceSyncOpts {
  fs: IFileSystem
  tracker: DirtyTracker
  organizationId: string
  agentId: string
  contactId: string
  drive: FilesService
  logger: HarnessLogger
  /** Friendly agent name surfaced in proposal copy. Defaults to "The agent". */
  agentName?: string
  /** Auth lookup for resolving staff display names in proposal copy. Optional — falls back to staffId. */
  authLookup?: StaffProfileLookup
  /**
   * Conversation that produced this wake. Forwarded to `insertProposal` so
   * decide-time journal events (`change.approved` / `change.rejected`) and the
   * follow-up `change_decided` wake have a conversation to attach to. Null for
   * standalone-lane wakes (operator-thread, heartbeat) — those don't have a
   * customer conversation to surface decisions back into.
   */
  conversationId?: string | null
  /**
   * Realtime broadcast for memory updates. After persisting agent / contact
   * MEMORY.md the listener fires `pg_notify` so the frontend's Memory panel
   * (and the Drive browser preview) refresh without a manual reload. Optional
   * because some tests don't exercise the realtime path.
   */
  realtime?: RealtimeService | null
}

export function createWorkspaceSyncListener(opts: WorkspaceSyncOpts): (event: AgentEvent) => Promise<void> {
  const { fs, tracker, organizationId, agentId, contactId, drive, logger, realtime, agentName, authLookup } = opts
  const conversationId = opts.conversationId ?? null

  return async (event: AgentEvent): Promise<void> => {
    if (event.type !== 'agent_end') return

    const scoped = await tracker.flush(fs)

    // ── 0. Staff MEMORY.md → agent_staff_memory upserts ────────────────
    for (const [staffId, diff] of scoped.staffMemory) {
      if (!isDirty(diff)) continue
      try {
        const raw = await fs.readFile(`/staff/${staffId}/MEMORY.md`)
        // Strip the materializer's render-time budget header so storage stays
        // presentation-clean. The header is re-stamped on the next render.
        const content = stripBudgetHeader(raw)
        await upsertStaffMemory({ organizationId, agentId, staffId }, content)
      } catch (err) {
        logger.warn({ err, staffId }, 'workspace-sync: failed to flush staff MEMORY.md')
      }
    }

    // ── 1a. Agent MEMORY.md → agent_definitions.working_memory ──────────
    if (isDirty(scoped.agentMemory)) {
      const agentMemoryPath = `/agents/${agentId}/MEMORY.md`
      try {
        const raw = await fs.readFile(agentMemoryPath)
        const content = stripBudgetHeader(raw)
        await drive.writePath({ scope: 'agent', agentId }, '/MEMORY.md', content)
        logger.info({ agentId, bytes: content.length }, 'workspace-sync: persisted agent MEMORY.md')
        try {
          realtime?.notify({ table: 'agent_definitions', id: agentId, action: 'memory_updated' })
        } catch {
          // notify is best-effort — frontend will still refresh on the next manual fetch.
        }
      } catch (err) {
        logger.warn({ err, agentId }, 'workspace-sync: failed to flush agent MEMORY.md')
      }
    }

    // ── 1b. Contact MEMORY.md → contacts.memory column ──────────────────
    const contactDrivePrefix = `/contacts/${contactId}/drive`
    const contactMemoryPath = `/contacts/${contactId}/MEMORY.md`

    if (isDirty(scoped.contactMemory)) {
      try {
        const raw = await fs.readFile(contactMemoryPath)
        const content = stripBudgetHeader(raw)
        await drive.writePath({ scope: 'contact', contactId }, '/MEMORY.md', content)
        logger.info({ contactId, bytes: content.length }, 'workspace-sync: persisted contact MEMORY.md')
        try {
          realtime?.notify({ table: 'contacts', id: contactId, action: 'memory_updated' })
        } catch {
          // notify is best-effort.
        }
      } catch (err) {
        logger.warn({ err, contactId }, 'workspace-sync: failed to flush contact MEMORY.md')
      }
    }

    // ── 1c. profile.md frontmatter → field_set proposals ────────────────
    for (const profilePath of dirtyPaths(scoped.contactProfile)) {
      const id = matchScopedId(profilePath, '/contacts/')
      if (!id) continue
      await flushProfile({
        workspacePath: profilePath,
        resourceId: id,
        loadBaseline: () => getContact(id),
        renderBaseline: renderContactFrontmatter,
        allowedFields: CONTACT_SCALAR_FIELDS,
        resource: CONTACT_RESOURCE,
        subjectNoun: 'contact',
        subjectFromBaseline: (row) => row.displayName ?? row.phone ?? row.email ?? row.id,
        requiresApproval: false,
        requiresApprovalForFields: CONTACT_GATED_FIELDS,
        loadAttrLabels: () => loadContactAttrLabels(organizationId),
        idLogKey: 'contactId',
      })
    }
    for (const [staffId, diff] of scoped.staffProfile) {
      if (!isDirty(diff)) continue
      const profilePath = `/staff/${staffId}/profile.md`
      await flushProfile({
        workspacePath: profilePath,
        resourceId: staffId,
        loadBaseline: () => staffService.find(staffId),
        renderBaseline: renderStaffFrontmatter,
        allowedFields: STAFF_SCALAR_FIELDS,
        resource: STAFF_RESOURCE,
        subjectNoun: 'staff member',
        subjectFromBaseline: async (row) => {
          if (row.displayName) return row.displayName
          const auth = await authLookup?.getAuthDisplay(staffId).catch(() => null)
          return auth?.name ?? auth?.email ?? staffId
        },
        requiresApproval: true,
        requiresApprovalForFields: STAFF_GATED_FIELDS,
        loadAttrLabels: () => loadStaffAttrLabels(organizationId),
        idLogKey: 'staffId',
      })
    }

    // ── 2. Contact drive → FilesService (scope='contact') ──────────────────
    const contactScope: DriveScope = { scope: 'contact', contactId }

    for (const wPath of [...scoped.contactDrive.added, ...scoped.contactDrive.changed]) {
      try {
        const content = await fs.readFile(wPath)
        const drivePath = wPath.slice(contactDrivePrefix.length) || '/'
        const name = drivePath.split('/').filter(Boolean).pop() ?? drivePath

        const existing = await drive.getByPath(contactScope, drivePath)
        if (!existing) {
          const input: CreateFileInput = {
            kind: 'file',
            name,
            path: drivePath,
            mimeType: 'text/markdown',
            extractedText: content,
            source: 'agent_uploaded',
          }
          await drive.create(contactScope, input)
        }
        // Content updates on existing files are deferred to Phase 3 (no update-content on FilesService yet).
      } catch (err) {
        logger.warn({ err, wPath }, 'workspace-sync: failed to persist contact drive file')
      }
    }

    for (const wPath of scoped.contactDrive.deleted) {
      try {
        const drivePath = wPath.slice(contactDrivePrefix.length) || '/'
        const existing = await drive.getByPath(contactScope, drivePath)
        if (existing) await drive.remove(existing.id)
      } catch (err) {
        logger.warn({ err, wPath }, 'workspace-sync: failed to delete contact drive file')
      }
    }
  }

  /**
   * Resolve the workspace's current frontmatter against the canonical row
   * baseline and emit one `field_set` proposal for the delta. Caller injects
   * the row loader, renderer, and resource identity; everything else is shared.
   *
   * The proposal's `rationale` and `expectedOutcome` are synthesised by
   * `buildFieldSetCopy` from the baseline subject name, the diff, and the
   * resource's approval gates so the SME inbox shows readable prose, not
   * harness jargon.
   */
  async function flushProfile<T>(cfg: {
    workspacePath: string
    resourceId: string
    loadBaseline: () => Promise<T | null>
    renderBaseline: (row: T) => string
    allowedFields: ReadonlySet<string>
    resource: { module: string; type: string }
    subjectNoun: 'contact' | 'staff member'
    subjectFromBaseline: (row: T) => string | Promise<string>
    requiresApproval: boolean
    requiresApprovalForFields: ReadonlySet<string>
    loadAttrLabels: () => Promise<AttrLabelMap>
    idLogKey: string
  }): Promise<void> {
    const logCtx = { [cfg.idLogKey]: cfg.resourceId } as Record<string, unknown>

    let current: ParsedProfile | null
    try {
      current = parseFrontmatter(await fs.readFile(cfg.workspacePath))
    } catch (err) {
      logger.warn({ ...logCtx, err, workspacePath: cfg.workspacePath }, 'workspace-sync: failed to read profile.md')
      return
    }
    if (!current) {
      logger.warn(
        { ...logCtx, workspacePath: cfg.workspacePath },
        'workspace-sync: profile.md has no parseable frontmatter — skipped',
      )
      return
    }

    let baseline: ParsedProfile | null
    let baselineRow: T | null
    try {
      baselineRow = await cfg.loadBaseline()
      if (!baselineRow) {
        logger.warn(logCtx, 'workspace-sync: baseline row not found — skipped')
        return
      }
      baseline = parseFrontmatter(cfg.renderBaseline(baselineRow))
    } catch (err) {
      logger.warn({ ...logCtx, err }, 'workspace-sync: failed to load profile baseline')
      return
    }
    if (!baseline || !baselineRow) return

    const diff = diffProfile(baseline, current)
    const filtered = filterDiffFields(diff.fields, cfg.allowedFields, logger, cfg.resource.type)
    if (Object.keys(filtered).length === 0) return

    // Best-effort copy enrichment: subject name + attribute labels. Failures
    // here fall back to the readable defaults inside `buildFieldSetCopy`.
    const [subjectName, attrLabels] = await Promise.all([
      Promise.resolve(cfg.subjectFromBaseline(baselineRow)).catch(() => cfg.resourceId),
      cfg.loadAttrLabels().catch(() => new Map() as AttrLabelMap),
    ])
    const copy = buildFieldSetCopy({
      subjectName,
      subjectNoun: cfg.subjectNoun,
      agentName,
      fields: filtered,
      requiresApproval: cfg.requiresApproval,
      requiresApprovalForFields: cfg.requiresApprovalForFields,
      attrLabels,
    })

    const payload: ChangePayload = { kind: 'field_set', fields: filtered }
    try {
      await insertProposal({
        organizationId,
        resourceModule: cfg.resource.module,
        resourceType: cfg.resource.type,
        resourceId: cfg.resourceId,
        payload,
        changedBy: `agent:${agentId}`,
        changedByKind: 'agent',
        rationale: copy.rationale,
        expectedOutcome: copy.expectedOutcome,
        conversationId,
      })
    } catch (err) {
      if (err instanceof Error && /already has a pending proposal/.test(err.message)) {
        logger.info(logCtx, 'workspace-sync: duplicate pending proposal — skipped')
        return
      }
      logger.warn({ ...logCtx, err }, 'workspace-sync: failed to insert field_set proposal')
    }
  }
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

function isDirty(diff: DirtyDiff): boolean {
  return diff.added.length > 0 || diff.changed.length > 0
}

function dirtyPaths(diff: DirtyDiff): string[] {
  return [...diff.added, ...diff.changed]
}

/** Extract `<id>` from `/<scope>/<id>/profile.md`; returns null if no match. */
function matchScopedId(path: string, prefix: string): string | null {
  if (!path.startsWith(prefix)) return null
  const tail = path.slice(prefix.length)
  const slash = tail.indexOf('/')
  if (slash <= 0) return null
  return tail.slice(0, slash)
}

/** Drop diff entries whose top-level scalar key is unknown to the resource
 *  materializer; `attributes.*` keys always pass. One `logger.warn` summarises
 *  any drops so junk frontmatter keys are loud, not silent. */
function filterDiffFields(
  fields: Record<string, FieldDiff>,
  knownTopLevel: ReadonlySet<string>,
  logger: HarnessLogger,
  resourceType: string,
): Record<string, FieldDiff> {
  const dropped: string[] = []
  let anyDropped = false
  const out: Record<string, FieldDiff> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (key.startsWith('attributes.') || knownTopLevel.has(key)) {
      out[key] = value
      continue
    }
    dropped.push(key)
    anyDropped = true
  }
  if (anyDropped) {
    logger.warn({ resourceType, dropped }, 'workspace-sync: dropped unknown frontmatter keys from field_set proposal')
  }
  return anyDropped ? out : fields
}
