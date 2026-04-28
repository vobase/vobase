/**
 * Drive overlay providers for the built-in PROFILE.md / MEMORY.md / AGENTS.md
 * virtual files. These three overlays were historically synthesized inline in
 * `files.ts` `listFolder` (a SECOND overlay path running parallel to the
 * `DriveOverlayProvider` registry). This module collapses them into the
 * registry so there is exactly one overlay seam.
 *
 * Backing columns:
 *   - contact: `contacts.profile` / `contacts.memory`
 *   - staff:   `staff_profiles.profile` / `staff_profiles.memory`
 *   - agent:   `agent_definitions.instructions` (AGENTS.md, READ-ONLY here —
 *              composition / write surface lives in agents/components/agents-md-editor)
 *              and `agent_definitions.working_memory` (MEMORY.md)
 *
 * Cross-org isolation: every read filters by `ctx.organizationId`. The
 * underlying `read*VirtualColumn` helpers issue queries scoped to
 * `organizationId AND id=<scopeId>`, so a provider cannot return another
 * org's data.
 *
 * AGENTS.md write is intentionally unsupported. The agents detail page edits
 * `agent_definitions.instructions` directly via the agents RPC; routing
 * AGENTS.md writes through this overlay would invite a second mutation seam.
 */

import { agentDefinitions } from '@modules/agents/schema'
import { contacts } from '@modules/contacts/schema'
import { staffProfiles } from '@modules/team/schema'
import { and, eq } from 'drizzle-orm'

import type { DriveFile } from '../schema'
import { composeVirtualContent, stripVirtualHeader, virtualDriveFile } from './files'
import type {
  DriveOverlayContext,
  DriveOverlayProvider,
  DriveOverlayReadContext,
  DriveOverlayWriteContext,
} from './overlays'
import type { VirtualBackingScope, VirtualField } from './virtual-ids'

// ─── DB shim ───────────────────────────────────────────────────────────────
//
// Mirrors the structural-typing approach in `files.ts` `FilesDb`: accept any
// `unknown` at the boundary, then cast to the slice of drizzle's chainable
// API the helpers below need. Same shape as `files.ts` `FilesDb`.

type Db = {
  select: (cols?: unknown) => {
    from: (t: unknown) => {
      where: (c: unknown) => {
        limit: (n: number) => Promise<unknown[]>
      }
    }
  }
  update: (t: unknown) => {
    set: (v: unknown) => {
      where: (c: unknown) => Promise<unknown>
    }
  }
}

// ─── Column reads / writes (mirrors files.ts internal helpers) ─────────────

async function readContactColumn(
  db: Db,
  organizationId: string,
  scopeId: string,
  field: 'profile' | 'memory',
): Promise<{ body: string; updatedAt: Date | null } | null> {
  const rows = await db
    .select({ profile: contacts.profile, memory: contacts.memory, updatedAt: contacts.updatedAt })
    .from(contacts)
    .where(and(eq(contacts.organizationId, organizationId), eq(contacts.id, scopeId)))
    .limit(1)
  const row = rows[0] as { profile: string; memory: string; updatedAt: Date } | undefined
  if (!row) return null
  return { body: row[field] ?? '', updatedAt: row.updatedAt ?? null }
}

async function writeContactColumn(
  db: Db,
  organizationId: string,
  scopeId: string,
  field: 'profile' | 'memory',
  value: string,
): Promise<void> {
  await db
    .update(contacts)
    .set({ [field]: value })
    .where(and(eq(contacts.organizationId, organizationId), eq(contacts.id, scopeId)))
}

async function readStaffColumn(
  db: Db,
  organizationId: string,
  scopeId: string,
  field: 'profile' | 'memory',
): Promise<{ body: string; updatedAt: Date | null } | null> {
  const rows = await db
    .select({ profile: staffProfiles.profile, memory: staffProfiles.memory, updatedAt: staffProfiles.updatedAt })
    .from(staffProfiles)
    .where(and(eq(staffProfiles.organizationId, organizationId), eq(staffProfiles.userId, scopeId)))
    .limit(1)
  const row = rows[0] as { profile: string; memory: string; updatedAt: Date } | undefined
  if (!row) return null
  return { body: row[field] ?? '', updatedAt: row.updatedAt ?? null }
}

async function writeStaffColumn(
  db: Db,
  organizationId: string,
  scopeId: string,
  field: 'profile' | 'memory',
  value: string,
): Promise<void> {
  await db
    .update(staffProfiles)
    .set({ [field]: value })
    .where(and(eq(staffProfiles.organizationId, organizationId), eq(staffProfiles.userId, scopeId)))
}

async function readAgentColumn(
  db: Db,
  organizationId: string,
  scopeId: string,
  field: 'instructions' | 'memory',
): Promise<{ body: string; updatedAt: Date | null } | null> {
  const rows = await db
    .select({
      instructions: agentDefinitions.instructions,
      workingMemory: agentDefinitions.workingMemory,
      updatedAt: agentDefinitions.updatedAt,
    })
    .from(agentDefinitions)
    .where(and(eq(agentDefinitions.organizationId, organizationId), eq(agentDefinitions.id, scopeId)))
    .limit(1)
  const row = rows[0] as { instructions: string; workingMemory: string; updatedAt: Date } | undefined
  if (!row) return null
  const body = field === 'instructions' ? row.instructions : row.workingMemory
  return { body: body ?? '', updatedAt: row.updatedAt ?? null }
}

async function writeAgentMemory(db: Db, organizationId: string, scopeId: string, value: string): Promise<void> {
  await db
    .update(agentDefinitions)
    .set({ workingMemory: value })
    .where(and(eq(agentDefinitions.organizationId, organizationId), eq(agentDefinitions.id, scopeId)))
}

// ─── Provider factories ────────────────────────────────────────────────────

function makeRow(
  organizationId: string,
  backingScope: VirtualBackingScope,
  scopeIdVal: string,
  field: VirtualField,
  updatedAt: Date,
): DriveFile {
  return virtualDriveFile(organizationId, backingScope, scopeIdVal, field, updatedAt)
}

export const CONTACT_BUILTIN_PROVIDER_ID = 'drive/builtin-contact'
export const STAFF_BUILTIN_PROVIDER_ID = 'drive/builtin-staff'
export const AGENT_BUILTIN_PROVIDER_ID = 'drive/builtin-agent'

/**
 * Builtin overlay for `contact` scope: surfaces /PROFILE.md and /MEMORY.md
 * backed by `contacts.profile` / `contacts.memory`.
 */
export function createContactBuiltinOverlay(dbRaw: unknown): DriveOverlayProvider {
  const db = dbRaw as Db
  return {
    id: CONTACT_BUILTIN_PROVIDER_ID,
    appliesTo: ['contact'],

    async list(ctx: DriveOverlayContext): Promise<DriveFile[]> {
      if (ctx.scope.scope !== 'contact') return []
      if (ctx.parentId !== null) return []
      const scopeIdVal = ctx.scope.contactId
      const row = await readContactColumn(db, ctx.organizationId, scopeIdVal, 'profile')
      if (!row) return []
      const updatedAt = row.updatedAt ?? new Date(0)
      return [
        makeRow(ctx.organizationId, 'contact', scopeIdVal, 'profile', updatedAt),
        makeRow(ctx.organizationId, 'contact', scopeIdVal, 'memory', updatedAt),
      ]
    },

    async read(ctx: DriveOverlayReadContext): Promise<{ content: string; updatedAt?: Date } | null> {
      if (ctx.scope.scope !== 'contact') return null
      const field: 'profile' | 'memory' | null =
        ctx.path === '/PROFILE.md' ? 'profile' : ctx.path === '/MEMORY.md' ? 'memory' : null
      if (!field) return null
      const row = await readContactColumn(db, ctx.organizationId, ctx.scope.contactId, field)
      if (!row) return null
      return {
        content: composeVirtualContent(field, row.body, 'contact'),
        updatedAt: row.updatedAt ?? undefined,
      }
    },

    async write(ctx: DriveOverlayWriteContext): Promise<void> {
      if (ctx.scope.scope !== 'contact') return
      const field: 'profile' | 'memory' | null =
        ctx.path === '/PROFILE.md' ? 'profile' : ctx.path === '/MEMORY.md' ? 'memory' : null
      if (!field) return
      const body = stripVirtualHeader(ctx.content)
      await writeContactColumn(db, ctx.organizationId, ctx.scope.contactId, field, body)
    },
  }
}

/**
 * Builtin overlay for `staff` scope: surfaces /PROFILE.md and /MEMORY.md
 * backed by `staff_profiles.profile` / `staff_profiles.memory`.
 */
export function createStaffBuiltinOverlay(dbRaw: unknown): DriveOverlayProvider {
  const db = dbRaw as Db
  return {
    id: STAFF_BUILTIN_PROVIDER_ID,
    appliesTo: ['staff'],

    async list(ctx: DriveOverlayContext): Promise<DriveFile[]> {
      if (ctx.scope.scope !== 'staff') return []
      if (ctx.parentId !== null) return []
      const scopeIdVal = ctx.scope.userId
      const row = await readStaffColumn(db, ctx.organizationId, scopeIdVal, 'profile')
      if (!row) return []
      const updatedAt = row.updatedAt ?? new Date(0)
      return [
        makeRow(ctx.organizationId, 'staff', scopeIdVal, 'profile', updatedAt),
        makeRow(ctx.organizationId, 'staff', scopeIdVal, 'memory', updatedAt),
      ]
    },

    async read(ctx: DriveOverlayReadContext): Promise<{ content: string; updatedAt?: Date } | null> {
      if (ctx.scope.scope !== 'staff') return null
      const field: 'profile' | 'memory' | null =
        ctx.path === '/PROFILE.md' ? 'profile' : ctx.path === '/MEMORY.md' ? 'memory' : null
      if (!field) return null
      const row = await readStaffColumn(db, ctx.organizationId, ctx.scope.userId, field)
      if (!row) return null
      return {
        content: composeVirtualContent(field, row.body, 'staff'),
        updatedAt: row.updatedAt ?? undefined,
      }
    },

    async write(ctx: DriveOverlayWriteContext): Promise<void> {
      if (ctx.scope.scope !== 'staff') return
      const field: 'profile' | 'memory' | null =
        ctx.path === '/PROFILE.md' ? 'profile' : ctx.path === '/MEMORY.md' ? 'memory' : null
      if (!field) return
      const body = stripVirtualHeader(ctx.content)
      await writeStaffColumn(db, ctx.organizationId, ctx.scope.userId, field, body)
    },
  }
}

/**
 * Builtin overlay for `agent` scope: surfaces /AGENTS.md (read-only, backed by
 * `agent_definitions.instructions`) and /MEMORY.md (read-write, backed by
 * `agent_definitions.working_memory`).
 *
 * Why AGENTS.md is read-only: the agents detail page edits `instructions` via
 * the agents RPC. Allowing a second mutation seam through this overlay would
 * fork the agent-write path.
 */
export function createAgentBuiltinOverlay(dbRaw: unknown): DriveOverlayProvider {
  const db = dbRaw as Db
  return {
    id: AGENT_BUILTIN_PROVIDER_ID,
    appliesTo: ['agent'],

    async list(ctx: DriveOverlayContext): Promise<DriveFile[]> {
      if (ctx.scope.scope !== 'agent') return []
      if (ctx.parentId !== null) return []
      const scopeIdVal = ctx.scope.agentId
      const row = await readAgentColumn(db, ctx.organizationId, scopeIdVal, 'instructions')
      if (!row) return []
      const updatedAt = row.updatedAt ?? new Date(0)
      return [
        makeRow(ctx.organizationId, 'agent', scopeIdVal, 'instructions', updatedAt),
        makeRow(ctx.organizationId, 'agent', scopeIdVal, 'memory', updatedAt),
      ]
    },

    async read(ctx: DriveOverlayReadContext): Promise<{ content: string; updatedAt?: Date } | null> {
      if (ctx.scope.scope !== 'agent') return null
      const field: 'instructions' | 'memory' | null =
        ctx.path === '/AGENTS.md' ? 'instructions' : ctx.path === '/MEMORY.md' ? 'memory' : null
      if (!field) return null
      const row = await readAgentColumn(db, ctx.organizationId, ctx.scope.agentId, field)
      if (!row) return null
      return {
        content: composeVirtualContent(field, row.body, 'agent'),
        updatedAt: row.updatedAt ?? undefined,
      }
    },

    async write(ctx: DriveOverlayWriteContext): Promise<void> {
      if (ctx.scope.scope !== 'agent') return
      // AGENTS.md is read-only at this overlay. /MEMORY.md routes to working_memory.
      if (ctx.path === '/AGENTS.md') {
        throw new Error('drive/builtin-agent: AGENTS.md is read-only — edit agent.instructions via the agents RPC')
      }
      if (ctx.path !== '/MEMORY.md') return
      const body = stripVirtualHeader(ctx.content)
      await writeAgentMemory(db, ctx.organizationId, ctx.scope.agentId, body)
    },
  }
}
