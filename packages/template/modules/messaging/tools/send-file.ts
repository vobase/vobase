import { type Static, Type } from '@sinclair/typebox'
import { defineAgentTool } from '@vobase/core'

import { appendMediaMessage } from '../service/messages'

export const SendFileInputSchema = Type.Object({
  driveFileId: Type.String({ minLength: 1 }),
  caption: Type.Optional(Type.String()),
})

export type SendFileInput = Static<typeof SendFileInputSchema>

/** Phase 2 stub — always passes. Real hermes threat-scan patterns land in Phase 2.5+. */
// biome-ignore lint/suspicious/useAwait: contract requires async signature
async function runThreatScan(_driveFileId: string): Promise<{ ok: boolean }> {
  return { ok: true }
}

export const sendFileTool = defineAgentTool({
  name: 'send_file',
  description: 'Send a drive file to the customer. Requires staff approval if agent.fileApprovalRequired=true.',
  schema: SendFileInputSchema,
  errorCode: 'SEND_FILE_ERROR',
  requiresApproval: true,
  audience: 'customer',
  lane: 'conversation',
  prompt:
    "Use when the customer needs an artefact (PDF, image, doc) that already exists in `/drive/`. The drive file id comes from `cat`-ing the file or grepping the drive listing — never fabricate ids. Captions are optional but help the customer understand what they're receiving.",
  async run(args, ctx) {
    const scan = await runThreatScan(args.driveFileId)
    if (!scan.ok) {
      throw new Error('File failed threat scan')
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
    return { messageId: msg.id }
  },
})
