/**
 * State-machine helper. Every module with state-machine flavored
 * tables declares its allowed transitions in `modules/<name>/state.ts` as data;
 * `applyTransition` is the only path for runtime code to change those statuses.
 *
 * Enforced by `scripts/check-module-shape.ts`: state transitions outside
 * `state.ts` imports are a lint error.
 */

export interface TransitionTable<TStatus extends string> {
  /** Every allowed `from → to` edge. Edges not listed throw `InvalidTransitionError`. */
  readonly transitions: ReadonlyArray<{ from: TStatus; to: TStatus; event?: string }>
  readonly terminal: readonly TStatus[]
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly fromStatus: string,
    public readonly toStatus: string,
    public readonly tableName: string,
  ) {
    super(`invalid transition ${fromStatus} → ${toStatus} (table: ${tableName})`)
    this.name = 'InvalidTransitionError'
  }
}

export function applyTransition<TStatus extends string>(
  table: TransitionTable<TStatus>,
  current: TStatus,
  next: TStatus,
  tableName = 'unknown',
): TStatus {
  if (current === next) return current
  if (table.terminal.includes(current)) {
    throw new InvalidTransitionError(current, next, tableName)
  }
  const edge = table.transitions.find((t) => t.from === current && t.to === next)
  if (!edge) {
    throw new InvalidTransitionError(current, next, tableName)
  }
  return next
}

export function isTerminal<TStatus extends string>(table: TransitionTable<TStatus>, status: TStatus): boolean {
  return table.terminal.includes(status)
}
