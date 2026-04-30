/**
 * Module-level state for the agents module — currently just the shared
 * `JobQueue` handle so handlers can enqueue wake jobs without threading
 * `ctx.jobs` through every call site. Mirrors the channels-state pattern
 * (`modules/channels/service/state.ts`).
 */

export interface JobQueueSendOpts {
  /** Replaces any still-pending job with the same key — drops earlier sends. */
  singletonKey?: string
  /** Delay before dispatch. Combined with `singletonKey` it gives debounce. */
  startAfter?: Date
}

export interface JobQueue {
  send(name: string, data: unknown, opts?: JobQueueSendOpts): Promise<string>
}

interface AgentsStateDeps {
  jobs?: JobQueue | null
}

export interface AgentsState {
  jobs: JobQueue | null
}

export function createAgentsState(deps: AgentsStateDeps = {}): AgentsState {
  return { jobs: deps.jobs ?? null }
}

let _current: AgentsState | null = null

export function installAgentsState(state: AgentsState): void {
  _current = state
}

export function __resetAgentsStateForTests(): void {
  _current = null
}

function current(): AgentsState {
  if (!_current) throw new Error('agents: state not installed — call installAgentsState() in module init')
  return _current
}

export function requireJobs(): JobQueue {
  const s = current()
  if (!s.jobs) throw new Error('agents: jobQueue not initialised')
  return s.jobs
}
