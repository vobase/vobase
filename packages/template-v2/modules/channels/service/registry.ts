/**
 * Channel adapter registry.
 *
 * Each adapter registers a factory + its capability map. The umbrella module's
 * `init` is the only place that wires registrations; every other consumer
 * (webhook router, outbound dispatcher, admin page) reads through here.
 */

import type { ChannelAdapter, ChannelCapabilities } from '@vobase/core'

export type ChannelAdapterFactory = (config: Record<string, unknown>, instanceId: string) => ChannelAdapter

interface Entry {
  factory: ChannelAdapterFactory
  capabilities: ChannelCapabilities
}

const registry = new Map<string, Entry>()

export function register(name: string, factory: ChannelAdapterFactory, capabilities: ChannelCapabilities): void {
  registry.set(name, { factory, capabilities })
}

export function get(name: string, config: Record<string, unknown>, instanceId: string): ChannelAdapter | null {
  return registry.get(name)?.factory(config, instanceId) ?? null
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
