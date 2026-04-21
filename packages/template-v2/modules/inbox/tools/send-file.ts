import { Type } from '@mariozechner/pi-ai'
import { appendMediaMessage } from '@modules/inbox/service/messages'
import type { AgentTool, ToolContext } from '@server/contracts/tool'
import type { ToolResult } from '@server/contracts/tool-result'
import type { Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

export const SendFileInputSchema = Type.Object({
  driveFileId: Type.String({ minLength: 1 }),
  caption: Type.Optional(Type.String()),
})

export type SendFileInput = Static<typeof SendFileInputSchema>

/** Phase 2 stub — always passes. Real hermes threat-scan patterns land in Phase 2.5+. */
async function runThreatScan(_driveFileId: string): Promise<{ ok: boolean }> {
  return { ok: true }
}

function firstError(value: unknown): string {
  const first = Value.Errors(SendFileInputSchema, value).First()
  return first ? `${first.path || 'root'}: ${first.message}` : 'invalid input'
}

export const sendFileTool: AgentTool<SendFileInput, { messageId: string }> = {
  name: 'send_file',
  description: 'Send a drive file to the customer. Requires staff approval if agent.fileApprovalRequired=true.',
  inputSchema: SendFileInputSchema,
  requiresApproval: true,
  parallelGroup: 'never',

  async execute(args, ctx: ToolContext): Promise<ToolResult<{ messageId: string }>> {
    if (!Value.Check(SendFileInputSchema, args)) {
      return {
        ok: false,
        error: `Invalid send_file input — ${firstError(args)}`,
        errorCode: 'VALIDATION_ERROR',
      }
    }

    const scan = await runThreatScan(args.driveFileId)
    if (!scan.ok) {
      return { ok: false, error: 'File failed threat scan', errorCode: 'THREAT_SCAN_FAILED', retryable: false }
    }

    const msg = await appendMediaMessage({
      conversationId: ctx.conversationId,
      organizationId: ctx.organizationId,
      agentId: ctx.agentId,
      wakeId: ctx.wakeId,
      turnIndex: ctx.turnIndex,
      toolCallId: ctx.toolCallId,
      driveFileId: args.driveFileId,
      caption: args.caption,
    })

    return { ok: true, content: { messageId: msg.id } }
  },
}
