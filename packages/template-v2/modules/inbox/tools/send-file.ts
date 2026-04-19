import { appendMediaMessage } from '@modules/inbox/service/messages'
import type { AgentTool, ToolContext } from '@server/contracts/tool'
import type { ToolResult } from '@server/contracts/tool-result'
import { z } from 'zod'

const SendFileInputSchema = z.object({
  driveFileId: z.string().min(1),
  caption: z.string().optional(),
})

export type SendFileInput = z.infer<typeof SendFileInputSchema>

/** Phase 2 stub — always passes. Real hermes threat-scan patterns land in Phase 2.5+. */
async function runThreatScan(_driveFileId: string): Promise<{ ok: boolean }> {
  return { ok: true }
}

export const sendFileTool: AgentTool<SendFileInput, { messageId: string }> = {
  name: 'send_file',
  description: 'Send a drive file to the customer. Requires staff approval if agent.fileApprovalRequired=true.',
  inputSchema: SendFileInputSchema,
  requiresApproval: true,
  parallelGroup: 'never',

  async execute(args, ctx: ToolContext): Promise<ToolResult<{ messageId: string }>> {
    const parsed = SendFileInputSchema.safeParse(args)
    if (!parsed.success) {
      return {
        ok: false,
        error: 'Invalid send_file input',
        errorCode: 'VALIDATION_ERROR',
        details: parsed.error.issues,
      }
    }

    const scan = await runThreatScan(parsed.data.driveFileId)
    if (!scan.ok) {
      return { ok: false, error: 'File failed threat scan', errorCode: 'THREAT_SCAN_FAILED', retryable: false }
    }

    const msg = await appendMediaMessage({
      conversationId: ctx.conversationId,
      tenantId: ctx.tenantId,
      agentId: ctx.agentId,
      wakeId: ctx.wakeId,
      turnIndex: ctx.turnIndex,
      toolCallId: ctx.toolCallId,
      driveFileId: parsed.data.driveFileId,
      caption: parsed.data.caption,
    })

    return { ok: true, content: { messageId: msg.id } }
  },
}
