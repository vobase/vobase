/**
 * Side-load collector.
 *
 * Per-turn dynamic content placed in the first user message. Rebuilt FRESH
 * per turn — mid-wake writes appear in the NEXT turn's side-load, never leak
 * into the current turn's frozen prompt (frozen-snapshot invariant).
 *
 * Items are priority-ordered DESCENDING (higher priority appears first) and
 * joined with `---` separators. Contributors that return `[]` are skipped.
 */

import type { SideLoadContributor, SideLoadCtx, SideLoadItem } from './types'
import type { Bash } from 'just-bash'

/**
 * Ad-hoc contributor shape used by the harness test-handle: the ctx is
 * augmented with `bash` so the contributor can execute commands (e.g. cat a
 * file from the test sandbox). Official contributors (`SideLoadContributor`)
 * use the spec shape.
 */
export interface CustomSideLoadMaterializer {
  kind: 'custom'
  priority: number
  contribute: (ctx: SideLoadCtx & { bash: Bash }) => Promise<string> | string
}

export interface CollectSideLoadOpts {
  ctx: SideLoadCtx
  contributors: readonly SideLoadContributor[]
  customMaterializers?: readonly CustomSideLoadMaterializer[]
  bash: Bash
}

/** Returns the concatenated side-load string for the turn. Empty string if nothing. */
export async function collectSideLoad(opts: CollectSideLoadOpts): Promise<string> {
  const items: SideLoadItem[] = []

  for (const contrib of opts.contributors) {
    try {
      const list = await contrib(opts.ctx)
      if (Array.isArray(list)) items.push(...list)
    } catch {
      /* contributor throws are swallowed — do not break side-load for one bad module */
    }
  }

  for (const custom of opts.customMaterializers ?? []) {
    try {
      const body = await custom.contribute({ ...opts.ctx, bash: opts.bash })
      if (typeof body === 'string' && body.length > 0) {
        items.push({
          kind: 'custom',
          priority: custom.priority,
          render: () => body,
        })
      }
    } catch {
      /* swallow */
    }
  }

  if (items.length === 0) return ''

  items.sort((a, b) => b.priority - a.priority)
  const rendered = items
    .map((it) => {
      try {
        return it.render()
      } catch {
        return ''
      }
    })
    .filter((s) => s.length > 0)

  if (rendered.length === 0) return ''
  return rendered.join('\n\n---\n\n')
}

/**
 * Trailing `## Last turn side-effects` section listing the bash commands
 * executed during the previous turn.
 *
 * `getHistory()` is called ONCE per turn when the collector materializes.
 * Callers (agent-runner) wire it to a mutable buffer they swap at turn
 * boundaries, so turn N's recorded commands surface in turn N+1's side-load
 * — never in turn N itself (frozen-snapshot invariant).
 *
 * Priority 0 keeps this block at the BOTTOM of the side-load when other
 * contributors use the documented priority-1 baseline.
 */
export function createBashHistoryMaterializer(getHistory: () => readonly string[]): CustomSideLoadMaterializer {
  return {
    kind: 'custom',
    priority: 0,
    contribute: () => {
      const hist = getHistory()
      if (!hist || hist.length === 0) return ''
      const lines = hist.map((cmd) => `- \`${cmd}\``).join('\n')
      return `## Last turn side-effects\n\n${lines}`
    },
  }
}
