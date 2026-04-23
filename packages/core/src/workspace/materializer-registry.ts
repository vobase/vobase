/**
 * Phase-tagged materializer dispatch.
 *
 * The workspace factory asks this registry for materializers by phase:
 *   - `frozen`   → eager writes baked into the system prompt (never re-read mid-wake)
 *   - `side-load`→ rebuilt every turn, appended to the first user message
 *   - `on-read`  → lazy; `Bash` only triggers the query when the agent `cat`s the path
 */
import type { WorkspaceMaterializer } from '../harness/types'

export class MaterializerRegistry {
  private readonly frozen: WorkspaceMaterializer[] = []
  private readonly sideLoad: WorkspaceMaterializer[] = []
  private readonly onRead: WorkspaceMaterializer[] = []

  constructor(materializers: readonly WorkspaceMaterializer[] = []) {
    for (const m of materializers) {
      this.add(m)
    }
  }

  add(m: WorkspaceMaterializer): void {
    switch (m.phase) {
      case 'frozen':
        this.frozen.push(m)
        return
      case 'side-load':
        this.sideLoad.push(m)
        return
      case 'on-read':
        this.onRead.push(m)
        return
      default: {
        const exhaustive: never = m.phase
        throw new Error(`materializer-registry: unknown phase "${String(exhaustive)}"`)
      }
    }
  }

  getFrozen(): readonly WorkspaceMaterializer[] {
    return this.frozen
  }

  getSideLoad(): readonly WorkspaceMaterializer[] {
    return this.sideLoad
  }

  getOnRead(): readonly WorkspaceMaterializer[] {
    return this.onRead
  }

  size(): number {
    return this.frozen.length + this.sideLoad.length + this.onRead.length
  }
}
