/**
 * Heartbeat-emitter registry — lets the agents module install a callback that
 * the automations cron-tick handler invokes once per ready row.
 *
 * The registry sits between two modules at boot: automations ships the table +
 * sweeper, agents ships the wake-pipeline emitter. Without an emitter
 * installed (e.g. tests that exercise schedule mutations only), the handler
 * runs but emits nothing — that's the documented no-op behaviour.
 */

import type { HeartbeatTrigger } from '@modules/automations/jobs'

export type HeartbeatEmitter = (trigger: HeartbeatTrigger) => Promise<void>

let _emitter: HeartbeatEmitter | null = null

export function setHeartbeatEmitter(fn: HeartbeatEmitter): void {
  _emitter = fn
}

export function getHeartbeatEmitter(): HeartbeatEmitter | null {
  return _emitter
}

export function __resetHeartbeatEmitterForTests(): void {
  _emitter = null
}
