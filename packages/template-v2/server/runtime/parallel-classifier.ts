/**
 * Groups pending tool calls into sequential `RunGroup`s where each group's
 * internal calls may be executed concurrently. Scheduler integration is
 * deferred — this module produces the metadata only.
 *
 * `AgentTool.parallelGroup`:
 *   'never' / omitted → always its own serial group (conservative default).
 *   'safe'            → batched with adjacent safe calls.
 *   path-scoped       → batched with adjacent path-scoped calls whose paths don't overlap.
 */

import type { AgentTool } from '@server/contracts/tool'

export interface ToolCall {
  tool: AgentTool
  args: unknown
}

export type RunGroup = { kind: 'serial'; call: ToolCall } | { kind: 'parallel'; calls: ToolCall[] }

/**
 * Returns true if path `a` and path `b` share any prefix (i.e. one is an
 * ancestor of the other, or they are the same path). Uses Unix-style
 * normalisation so callers need not worry about trailing slashes.
 */
export function pathsOverlap(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const na = norm(a)
  const nb = norm(b)
  return na === nb || na.startsWith(`${nb}/`) || nb.startsWith(`${na}/`)
}

function extractPath(call: ToolCall, pathArg: string): string | null {
  if (call.args !== null && typeof call.args === 'object') {
    const val = (call.args as Record<string, unknown>)[pathArg]
    if (typeof val === 'string') return val
  }
  return null
}

/**
 * Groups `calls` into sequential `RunGroup`s. Consecutive calls that may
 * safely run in parallel are folded into a single `{ kind: 'parallel' }` group.
 *
 * Rules applied left-to-right:
 * 1. `never` (or omitted) → flush pending batch, emit serial group.
 * 2. `safe` → accumulate into a safe batch (flush if previous batch was path-scoped).
 * 3. `path-scoped` → accumulate if no path overlap with existing path-scoped batch;
 *    otherwise flush and start a new path-scoped batch.
 */
export function classifyBatch(calls: ToolCall[]): RunGroup[] {
  if (calls.length === 0) return []

  const result: RunGroup[] = []
  let batch: ToolCall[] = []
  let batchMode: 'safe' | 'path-scoped' | null = null

  function flush(): void {
    if (batch.length === 0) return
    result.push({ kind: 'parallel', calls: [...batch] })
    batch = []
    batchMode = null
  }

  for (const call of calls) {
    const pg = call.tool.parallelGroup

    if (!pg || pg === 'never') {
      flush()
      result.push({ kind: 'serial', call })
      continue
    }

    if (pg === 'safe') {
      if (batchMode === 'path-scoped') flush()
      batchMode = 'safe'
      batch.push(call)
      continue
    }

    // path-scoped
    if (batchMode === 'safe') flush()

    const myPath = extractPath(call, pg.pathArg)
    const hasConflict =
      myPath !== null &&
      batch.some((existing) => {
        const epg = existing.tool.parallelGroup
        if (!epg || typeof epg !== 'object') return false
        const ePath = extractPath(existing, epg.pathArg)
        return ePath !== null && pathsOverlap(myPath, ePath)
      })

    if (hasConflict) flush()
    batchMode = 'path-scoped'
    batch.push(call)
  }

  flush()
  return result
}
