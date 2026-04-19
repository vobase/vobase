import type { ToolResultPersistedEvent } from '@server/contracts/event'
import type { ToolExecutionContext } from '@server/contracts/plugin-context'
import { L1_PREVIEW_BYTES } from './turn-budget'

export interface SpillDeps {
  stdout: string
  spillPath: string
  toolName: string
  ctx: ToolExecutionContext
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
  const byteLength = Buffer.byteLength(deps.stdout, 'utf8')
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
    tenantId: deps.ctx.tenantId,
    turnIndex: deps.ctx.turnIndex,
    type: 'tool_result_persisted',
    toolCallId: deps.ctx.toolCallId,
    toolName: deps.toolName,
    path: deps.spillPath,
    originalByteLength: byteLength,
  })
  return { preview, byteLength, persisted }
}
