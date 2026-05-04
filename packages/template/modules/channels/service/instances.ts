/**
 * Generic channel-instances CRUD.
 *
 * Adapter-agnostic: stores `config` as opaque JSONB. Each adapter's
 * `adapters/<name>/config.ts` Zod schema is the source of truth for what's
 * inside `config` — validation happens at the API edge in
 * `handlers/instances.ts`.
 *
 * Factory-DI service installed by `module.ts`; free-function wrappers route
 * through the installed instance for cross-module imports.
 */

import { type ChannelInstance, channelInstances } from '@modules/channels/schema'
import { and, eq, sql } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'

export interface CreateInstanceInput {
  organizationId: string
  channel: string
  role?: 'customer' | 'staff'
  displayName: string | null
  config: Record<string, unknown>
  webhookSecret?: string | null
}

export interface UpdateInstanceInput {
  displayName?: string | null
  config?: Record<string, unknown>
  webhookSecret?: string | null
  status?: string | null
  setupStage?: string | null
  lastError?: string | null
}

export interface ChannelInstancesService {
  list(organizationId: string, channel?: string): Promise<ChannelInstance[]>
  get(id: string): Promise<ChannelInstance | null>
  create(input: CreateInstanceInput): Promise<ChannelInstance>
  update(id: string, organizationId: string, patch: UpdateInstanceInput): Promise<ChannelInstance>
  remove(id: string, organizationId: string): Promise<void>
}

export function createChannelInstancesService(deps: { db: ScopedDb }): ChannelInstancesService {
  const { db } = deps

  async function list(organizationId: string, channel?: string): Promise<ChannelInstance[]> {
    const where = channel
      ? and(eq(channelInstances.organizationId, organizationId), eq(channelInstances.channel, channel))
      : eq(channelInstances.organizationId, organizationId)
    const rows = await db.select().from(channelInstances).where(where)
    return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }

  async function get(id: string): Promise<ChannelInstance | null> {
    const rows = await db.select().from(channelInstances).where(eq(channelInstances.id, id))
    return rows[0] ?? null
  }

  async function create(input: CreateInstanceInput): Promise<ChannelInstance> {
    const rows = await db
      .insert(channelInstances)
      .values({
        organizationId: input.organizationId,
        channel: input.channel,
        role: input.role ?? 'customer',
        displayName: input.displayName,
        config: input.config,
        webhookSecret: input.webhookSecret ?? null,
      })
      .returning()
    const created = rows[0]
    if (!created) throw new Error('channels/instances: failed to create row')
    return created
  }

  async function update(id: string, organizationId: string, patch: UpdateInstanceInput): Promise<ChannelInstance> {
    const setValues: Partial<typeof channelInstances.$inferInsert> = {}
    if (patch.displayName !== undefined) setValues.displayName = patch.displayName
    if (patch.config !== undefined) setValues.config = patch.config
    if (patch.webhookSecret !== undefined) setValues.webhookSecret = patch.webhookSecret
    if (patch.status !== undefined) setValues.status = patch.status
    if (patch.setupStage !== undefined) setValues.setupStage = patch.setupStage
    if (patch.lastError !== undefined) setValues.lastError = patch.lastError

    const rows = await db
      .update(channelInstances)
      .set(setValues)
      .where(and(eq(channelInstances.id, id), eq(channelInstances.organizationId, organizationId)))
      .returning()
    const updated = rows[0]
    if (!updated) throw new Error('channels/instances: row not found')
    return updated
  }

  async function remove(id: string, organizationId: string): Promise<void> {
    await db
      .delete(channelInstances)
      .where(and(eq(channelInstances.id, id), eq(channelInstances.organizationId, organizationId)))
  }

  return { list, get, create, update, remove }
}

let _current: ChannelInstancesService | null = null

export function installChannelInstancesService(svc: ChannelInstancesService): void {
  _current = svc
}

export function __resetChannelInstancesServiceForTests(): void {
  _current = null
}

function current(): ChannelInstancesService {
  if (!_current) throw new Error('channels/instances: service not installed — call installChannelInstancesService()')
  return _current
}

export function listInstances(organizationId: string, channel?: string): Promise<ChannelInstance[]> {
  return current().list(organizationId, channel)
}
export function getInstance(id: string): Promise<ChannelInstance | null> {
  return current().get(id)
}
export function createInstance(input: CreateInstanceInput): Promise<ChannelInstance> {
  return current().create(input)
}
export function updateInstance(
  id: string,
  organizationId: string,
  patch: UpdateInstanceInput,
): Promise<ChannelInstance> {
  return current().update(id, organizationId, patch)
}
export function removeInstance(id: string, organizationId: string): Promise<void> {
  return current().remove(id, organizationId)
}

// ─── Managed-mode upsert ────────────────────────────────────────────────────

export interface UpsertManagedInput {
  organizationId: string
  /**
   * Channel adapter discriminator (e.g., `'whatsapp'`). Must match a
   * registered adapter in `service/registry.ts`.
   */
  channel: string
  /**
   * Stable platform-side identifier — used as the idempotency key. Re-pushing
   * with the same `(organizationId, channel, platformChannelId)` is a no-op
   * (returns the existing row).
   */
  platformChannelId: string
  displayName: string
  /**
   * Adapter config to merge into the existing row (or insert as the seed).
   * The integrations module owns the platform-specific shape; channels just
   * persists it as opaque JSONB.
   */
  config: Record<string, unknown>
}

/**
 * Single-write-path entry point for the integrations module to materialize a
 * platform-managed channel instance. Channels owns the row; integrations is
 * the only caller. Idempotent on `(organizationId, channel, config.platformChannelId)`.
 */
export async function upsertManagedInstance(
  db: ScopedDb,
  input: UpsertManagedInput,
): Promise<{ instance: ChannelInstance; isNew: boolean }> {
  // Look up existing by `config->>'platformChannelId'` so re-handshakes are
  // no-ops. We can't put a unique index on a JSONB key without a generated
  // column, so the lookup is at-most-one filtered by channel + org.
  const existing = await db
    .select()
    .from(channelInstances)
    .where(
      and(
        eq(channelInstances.organizationId, input.organizationId),
        eq(channelInstances.channel, input.channel),
        sql`(config->>'platformChannelId') = ${input.platformChannelId}`,
      ),
    )
    .limit(1)

  if (existing.length > 0) {
    const row = existing[0]
    if (!row) {
      // Defensive — Array.length > 0 implies row, but TS narrowing requires the guard.
      throw new Error('channels/instances: managed lookup returned empty row')
    }
    const merged = { ...row.config, ...input.config }
    const [updated] = await db
      .update(channelInstances)
      .set({
        displayName: input.displayName,
        config: merged,
        status: 'active',
        setupStage: 'active',
        lastError: null,
      })
      .where(eq(channelInstances.id, row.id))
      .returning()
    if (!updated) {
      throw new Error('channels/instances: managed upsert update returned no row')
    }
    return { instance: updated, isNew: false }
  }

  const [created] = await db
    .insert(channelInstances)
    .values({
      organizationId: input.organizationId,
      channel: input.channel,
      role: 'customer',
      displayName: input.displayName,
      config: { ...input.config, platformChannelId: input.platformChannelId, mode: 'managed' },
      status: 'active',
      setupStage: 'active',
    })
    .returning()
  if (!created) {
    throw new Error('channels/instances: managed insert returned no row')
  }
  return { instance: created, isNew: true }
}
