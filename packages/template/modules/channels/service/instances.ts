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

import { findKind, type ManagedChannelKind } from '@modules/channels/managed/registry'
import { type ChannelInstance, channelInstances } from '@modules/channels/schema'
import { and, eq, ne, sql } from 'drizzle-orm'

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

/**
 * Soft-delete sentinel for `channel_instances.status`. We can't hard-delete
 * a row that still has conversations (FK `fk_conv_channel_instance` is
 * `ON DELETE RESTRICT` so message history is preserved), so "release" /
 * "disconnect" flips status to this value. Filtered out of `list()` and
 * the managed-claim idempotency probe.
 */
export const RELEASED_STATUS = 'released' as const

export interface ChannelInstancesService {
  list(organizationId: string, channel?: string): Promise<ChannelInstance[]>
  get(id: string): Promise<ChannelInstance | null>
  create(input: CreateInstanceInput): Promise<ChannelInstance>
  update(id: string, organizationId: string, patch: UpdateInstanceInput): Promise<ChannelInstance>
  /** Soft-delete: marks the row `status='released'`. Conversations stay attached. */
  remove(id: string, organizationId: string): Promise<void>
}

export function createChannelInstancesService(deps: { db: ScopedDb }): ChannelInstancesService {
  const { db } = deps

  async function list(organizationId: string, channel?: string): Promise<ChannelInstance[]> {
    // Hide soft-deleted rows. Released channels still exist (to preserve
    // conversation FKs) but should not surface in the channels listing
    // or the managed-claim idempotency probe.
    const baseWhere = and(
      eq(channelInstances.organizationId, organizationId),
      ne(channelInstances.status, RELEASED_STATUS),
    )
    const where = channel ? and(baseWhere, eq(channelInstances.channel, channel)) : baseWhere
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
    // Soft-delete via status. A hard delete would violate
    // `fk_conv_channel_instance` (`ON DELETE RESTRICT`) whenever a
    // conversation already routed through this channel, and the existing
    // UI copy ("Existing conversations are preserved but no new messages
    // will be received.") promises preservation anyway.
    await db
      .update(channelInstances)
      .set({ status: RELEASED_STATUS })
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
  /**
   * Optional explicit row id. Used on first insert so the tenant's
   * `channel_instances.id` matches the same id used by the platform's
   * `tester_links.channel_instance_id` (and therefore the URL the platform
   * forwards inbound webhooks to). Ignored on conflict — Postgres can't
   * change a primary key in `ON CONFLICT DO UPDATE`.
   */
  id?: string
  displayName: string
  /**
   * Adapter config to merge into the existing row (or insert as the seed).
   * The integrations module owns the platform-specific shape; channels just
   * persists it as opaque JSONB.
   */
  config: Record<string, unknown>
  /**
   * Channel role — `'customer'` for inbound customer-facing channels, `'staff'`
   * for staff-notification routing (`whatsapp_notif`). The CHECK constraint at
   * `channels/schema.ts` permits both values. Defaults to `'customer'`.
   */
  role?: 'customer' | 'staff'
  /**
   * Discriminator written into `config.mode`. Defaults to `'managed'`.
   * Notification claims pass `'managed-notif'` so `isManagedNotifConfig`
   * recognises the row.
   */
  mode?: 'managed' | 'managed-notif'
}

/**
 * Single-write-path entry point for the integrations module to materialize a
 * platform-managed channel instance. Channels owns the row; integrations is
 * the only caller. Idempotent on `(organizationId, channel, config.platformChannelId)`.
 *
 * The atomic INSERT … ON CONFLICT closes the SELECT-then-INSERT TOCTOU
 * window where two concurrent handshakes (boot auto-provision + admin
 * fallback handler) could each pass the existence probe and double-insert.
 * The conflict target is the partial unique index
 * `uq_channel_instances_managed_platform_id` over the generated
 * `platform_channel_id` column.
 */
export async function upsertManagedInstance(
  db: ScopedDb,
  input: UpsertManagedInput,
): Promise<{ instance: ChannelInstance; isNew: boolean }> {
  const mode = input.mode ?? 'managed'
  const role = input.role ?? 'customer'
  const seedConfig = { ...input.config, platformChannelId: input.platformChannelId, mode }
  const [row] = await db
    .insert(channelInstances)
    .values({
      ...(input.id ? { id: input.id } : {}),
      organizationId: input.organizationId,
      channel: input.channel,
      role,
      displayName: input.displayName,
      config: seedConfig,
      status: 'active',
      setupStage: 'active',
    })
    .onConflictDoUpdate({
      target: [channelInstances.organizationId, channelInstances.channel, channelInstances.platformChannelId],
      // The conflict target is a PARTIAL unique index
      // (`uq_channel_instances_managed_platform_id`) with predicate
      // `WHERE platform_channel_id IS NOT NULL`. Postgres requires the
      // ON CONFLICT clause to repeat that predicate so it can match the
      // partial index — drizzle exposes that via `targetWhere`.
      targetWhere: sql`platform_channel_id IS NOT NULL`,
      // Re-handshake: shallow-merge `config` so existing keys (e.g. an
      // adapter-set `lastSyncAt`) survive while the new payload overlays.
      // Use SQL merge so the existing row's own `config` is read at conflict
      // time — passing `input.config` directly would clobber any merge.
      set: {
        displayName: input.displayName,
        // Pass the patch as a serialized JSON string so postgres-js can bind
        // it as text; the explicit `::jsonb` cast turns it back at the
        // database boundary. Avoids the postgres-js auto-binder choking on
        // a plain JS object passed through `sql\`...\``.
        config: sql`${channelInstances.config} || ${JSON.stringify(seedConfig)}::jsonb`,
        status: 'active',
        setupStage: 'active',
        lastError: null,
      },
    })
    .returning({
      id: channelInstances.id,
      organizationId: channelInstances.organizationId,
      channel: channelInstances.channel,
      role: channelInstances.role,
      displayName: channelInstances.displayName,
      config: channelInstances.config,
      platformChannelId: channelInstances.platformChannelId,
      webhookSecret: channelInstances.webhookSecret,
      status: channelInstances.status,
      setupStage: channelInstances.setupStage,
      lastError: channelInstances.lastError,
      createdAt: channelInstances.createdAt,
      updatedAt: channelInstances.updatedAt,
      // `xmax = 0` is the canonical Postgres trick to detect "this row was
      // newly inserted" vs "this row was the conflict target updated" inside
      // a single ON CONFLICT statement — without a second round-trip.
      xmax: sql<string>`xmax`.as('xmax'),
    })
  if (!row) {
    throw new Error('channels/instances: managed upsert returned no row')
  }
  const isNew = row.xmax === '0'
  const { xmax: _xmax, ...rest } = row
  return { instance: rest, isNew }
}

/**
 * Resolve the org's active platform-managed channel instance for a given
 * registry kind, or `null` when the tenant has not claimed one yet.
 *
 * Parameterised by `kind` so callers stay registry-driven — adding a new
 * managed-channel kind (e.g. a future SMS-notification tier) needs only a new
 * registry entry, not a new lookup helper. Resolves the kind to its persisted
 * `channelName` via the registry, then picks the first active row.
 *
 * The `kind` argument is typed as `string` rather than `ManagedChannelKind`
 * so callers reading `kind` from JSONB config (where it's `string | null`)
 * don't need a runtime cast — `findKind` throws on unknown values.
 */
export async function findManagedChannel(organizationId: string, kind: string): Promise<ChannelInstance | null> {
  const entry = findKind(kind)
  const rows = await current().list(organizationId, entry.channelName)
  return rows.find((r) => r.status === 'active') ?? null
}

/**
 * Resolve the org's active notification-tier WhatsApp channel instance.
 * Convenience wrapper over the parameterised `findManagedChannel` so existing
 * callers (`mention-notify`, notification-mirror observer) stay terse.
 */
export function findNotificationChannel(organizationId: string): Promise<ChannelInstance | null> {
  return findManagedChannel(organizationId, 'notification' satisfies ManagedChannelKind)
}
