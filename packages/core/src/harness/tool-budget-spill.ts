import { L1_PREVIEW_BYTES } from './turn-budget'
import type { ToolContext, ToolResultPersistedEvent } from './types'

export interface SpillDeps {
  stdout: string
  /** Pre-computed UTF-8 byte length — callers already know it from the spill decision. */
  stdoutBytes?: number
  spillPath: string
  toolName: string
  ctx: ToolContext
  innerWrite: (path: string, content: string) => Promise<void>
  onSpill: (ev: ToolResultPersistedEvent) => void
}

export interface SpillOutput {
  preview: string
  byteLength: number
  persisted: { path: string; size: number; preview: string }
}

/** Write stdout to spillPath, emit ToolResultPersistedEvent, return preview + persisted metadata. */
export async function spillToFile(deps: SpillDeps): Promise<SpillOutput> {
  const byteLength = deps.stdoutBytes ?? Buffer.byteLength(deps.stdout, 'utf8')
  const preview = deps.stdout.slice(0, L1_PREVIEW_BYTES)
  try {
    await deps.innerWrite(deps.spillPath, deps.stdout)
  } catch {
    // best-effort; model still receives the preview
  }
  const persisted = { path: deps.spillPath, size: byteLength, preview }
  deps.onSpill({
    ts: new Date(),
    wakeId: deps.ctx.wakeId,
    conversationId: deps.ctx.conversationId,
    organizationId: deps.ctx.organizationId,
    turnIndex: deps.ctx.turnIndex,
    type: 'tool_result_persisted',
    toolCallId: deps.ctx.toolCallId,
    toolName: deps.toolName,
    path: deps.spillPath,
    originalByteLength: byteLength,
  })
  return { preview, byteLength, persisted }
}
