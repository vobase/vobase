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
import { and, eq } from 'drizzle-orm'

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
