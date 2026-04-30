/**
 * Web channel instance read helpers.
 *
 * The cross-channel `/channels` admin page uses the umbrella's generic CRUD
 * (`@modules/channels/service/instances`); this service exposes typed view
 * helpers tuned for web — `getPublicInstance` for the public chat link, and
 * `getInstanceDefaultAssignee` for the inbound handler.
 */

import { channelInstances } from '@modules/channels/schema'
import { and, eq } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'

type Row = typeof channelInstances.$inferSelect

export interface WebInstance {
  id: string
  organizationId: string
  displayName: string | null
  defaultAssignee: string | null
  origin: string | null
  starters: string[]
  status: string | null
  createdAt: Date
}

export interface PublicWebInstance {
  id: string
  displayName: string | null
  starters: string[]
}

export interface CreateWebInstanceInput {
  organizationId: string
  displayName: string
  defaultAssignee?: string | null
  origin?: string | null
  starters?: string[] | null
}

export interface UpdateWebInstanceInput {
  displayName?: string
  defaultAssignee?: string | null
  origin?: string | null
  starters?: string[] | null
}

function parseStarters(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 8)
}

function toInstance(r: Row): WebInstance {
  const cfg = (r.config ?? {}) as { defaultAssignee?: unknown; origin?: unknown; starters?: unknown }
  return {
    id: r.id,
    organizationId: r.organizationId,
    displayName: r.displayName,
    defaultAssignee: typeof cfg.defaultAssignee === 'string' ? cfg.defaultAssignee : null,
    origin: typeof cfg.origin === 'string' ? cfg.origin : null,
    starters: parseStarters(cfg.starters),
    status: r.status,
    createdAt: r.createdAt,
  }
}

export interface WebInstancesService {
  list(organizationId: string): Promise<WebInstance[]>
  getPublic(id: string): Promise<PublicWebInstance | null>
  getDefaultAssignee(id: string): Promise<string | null>
  create(input: CreateWebInstanceInput): Promise<WebInstance>
  update(id: string, organizationId: string, patch: UpdateWebInstanceInput): Promise<WebInstance>
  remove(id: string, organizationId: string): Promise<void>
}

const DEFAULT_STARTERS = ['What can you help me with?', 'How do I get started?', 'Tell me about your services'] as const

export function createWebInstancesService(deps: { db: ScopedDb }): WebInstancesService {
  const { db } = deps

  async function list(organizationId: string): Promise<WebInstance[]> {
    const rows = await db
      .select()
      .from(channelInstances)
      .where(and(eq(channelInstances.organizationId, organizationId), eq(channelInstances.channel, 'web')))
    return rows.map(toInstance).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }

  async function getPublic(id: string): Promise<PublicWebInstance | null> {
    const rows = await db
      .select()
      .from(channelInstances)
      .where(and(eq(channelInstances.id, id), eq(channelInstances.channel, 'web')))
    const row = rows[0]
    if (!row) return null
    const inst = toInstance(row)
    return {
      id: inst.id,
      displayName: inst.displayName,
      starters: inst.starters.length > 0 ? inst.starters : [...DEFAULT_STARTERS],
    }
  }

  async function getDefaultAssignee(id: string): Promise<string | null> {
    const rows = await db
      .select()
      .from(channelInstances)
      .where(and(eq(channelInstances.id, id), eq(channelInstances.channel, 'web')))
    const row = rows[0]
    if (!row) return null
    return toInstance(row).defaultAssignee
  }

  async function create(input: CreateWebInstanceInput): Promise<WebInstance> {
    const config: Record<string, unknown> = {}
    if (input.defaultAssignee) config.defaultAssignee = input.defaultAssignee
    if (input.origin) config.origin = input.origin
    if (input.starters && input.starters.length > 0) config.starters = input.starters

    const rows = await db
      .insert(channelInstances)
      .values({
        organizationId: input.organizationId,
        channel: 'web',
        role: 'customer',
        displayName: input.displayName,
        config,
      })
      .returning()
    const created = rows[0]
    if (!created) throw new Error('channel-web: failed to create instance')
    return toInstance(created)
  }

  async function update(id: string, organizationId: string, patch: UpdateWebInstanceInput): Promise<WebInstance> {
    const existingRows = await db
      .select()
      .from(channelInstances)
      .where(and(eq(channelInstances.id, id), eq(channelInstances.organizationId, organizationId)))
    const existing = existingRows[0]
    if (!existing) throw new Error('channel-web: instance not found')

    const nextConfig: Record<string, unknown> = { ...(existing.config ?? {}) }
    if (patch.defaultAssignee !== undefined) {
      if (patch.defaultAssignee) nextConfig.defaultAssignee = patch.defaultAssignee
      else delete nextConfig.defaultAssignee
    }
    if (patch.origin !== undefined) {
      if (patch.origin) nextConfig.origin = patch.origin
      else delete nextConfig.origin
    }
    if (patch.starters !== undefined) {
      if (patch.starters && patch.starters.length > 0) nextConfig.starters = patch.starters
      else delete nextConfig.starters
    }

    const setValues: Partial<typeof channelInstances.$inferInsert> = { config: nextConfig }
    if (patch.displayName !== undefined) setValues.displayName = patch.displayName

    const rows = await db
      .update(channelInstances)
      .set(setValues)
      .where(and(eq(channelInstances.id, id), eq(channelInstances.organizationId, organizationId)))
      .returning()
    const updated = rows[0]
    if (!updated) throw new Error('channel-web: instance not found')
    return toInstance(updated)
  }

  async function remove(id: string, organizationId: string): Promise<void> {
    await db
      .delete(channelInstances)
      .where(and(eq(channelInstances.id, id), eq(channelInstances.organizationId, organizationId)))
  }

  return { list, getPublic, getDefaultAssignee, create, update, remove }
}

let _currentService: WebInstancesService | null = null

export function installWebInstancesService(svc: WebInstancesService): void {
  _currentService = svc
}

export function __resetWebInstancesServiceForTests(): void {
  _currentService = null
}

function current(): WebInstancesService {
  if (!_currentService) {
    throw new Error('channel-web/instances: service not installed — call installWebInstancesService()')
  }
  return _currentService
}

// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function listInstances(organizationId: string): Promise<WebInstance[]> {
  return current().list(organizationId)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function getPublicInstance(id: string): Promise<PublicWebInstance | null> {
  return current().getPublic(id)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function getInstanceDefaultAssignee(id: string): Promise<string | null> {
  return current().getDefaultAssignee(id)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function createInstance(input: CreateWebInstanceInput): Promise<WebInstance> {
  return current().create(input)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function updateInstance(
  id: string,
  organizationId: string,
  patch: UpdateWebInstanceInput,
): Promise<WebInstance> {
  return current().update(id, organizationId, patch)
}
// biome-ignore lint/suspicious/useAwait: port-shim signature must match async contract
export async function removeInstance(id: string, organizationId: string): Promise<void> {
  return current().remove(id, organizationId)
}
