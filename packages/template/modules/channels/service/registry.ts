/**
 * Channel adapter registry.
 *
 * Each adapter registers a factory + its capability map. The umbrella module's
 * `init` is the only place that wires registrations; every other consumer
 * (webhook router, outbound dispatcher, admin page) reads through here.
 */

import type { ChannelAdapter, ChannelCapabilities } from '@vobase/core'

export type ChannelAdapterFactory = (
  config: Record<string, unknown>,
  instanceId: string,
) => ChannelAdapter | Promise<ChannelAdapter>

interface Entry {
  factory: ChannelAdapterFactory
  capabilities: ChannelCapabilities
}

const registry = new Map<string, Entry>()

export function register(name: string, factory: ChannelAdapterFactory, capabilities: ChannelCapabilities): void {
  registry.set(name, { factory, capabilities })
}

// biome-ignore lint/suspicious/useAwait: returns the factory's Promise<ChannelAdapter> | ChannelAdapter via async wrapper
export async function get(
  name: string,
  config: Record<string, unknown>,
  instanceId: string,
): Promise<ChannelAdapter | null> {
  const entry = registry.get(name)
  if (!entry) return null
  return entry.factory(config, instanceId)
}

export function list(): Array<{ name: string; capabilities: ChannelCapabilities }> {
  return Array.from(registry.entries(), ([name, entry]) => ({ name, capabilities: entry.capabilities }))
}

export function capabilitiesFor(name: string): ChannelCapabilities | null {
  return registry.get(name)?.capabilities ?? null
}

export function __resetForTests(): void {
  registry.clear()
}
