/**
 * Materializer dispatch. Every registered materializer fires once at
 * `agent_start` (frozen-snapshot semantics) — there is currently no other
 * timing. The `phase` field on `WorkspaceMaterializer` is retained for future
 * routing but only `'frozen'` is wired up.
 */
import type { WorkspaceMaterializer } from '../harness/types'

export class MaterializerRegistry {
  private readonly frozen: WorkspaceMaterializer[] = []

  constructor(materializers: readonly WorkspaceMaterializer[] = []) {
    for (const m of materializers) {
      this.add(m)
    }
  }

  add(m: WorkspaceMaterializer): void {
    this.frozen.push(m)
  }

  getFrozen(): readonly WorkspaceMaterializer[] {
    return this.frozen
  }

  size(): number {
    return this.frozen.length
  }
}
