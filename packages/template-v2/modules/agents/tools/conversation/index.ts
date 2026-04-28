/**
 * Conversation-lane tools. Customer-facing dispatches: `reply`, `send_card`,
 * `send_file`, `book_slot`. The capability registry binds these to every
 * conversation-lane wake reason (inbound, supervisor, approval-resumed,
 * scheduled-followup, manual).
 *
 * Live here (not in messaging) for the same reason `standaloneTools` lives
 * in `tools/standalone/` — lane partitions the tool catalogue per the
 * dual-surface convention. Service imports still cross into
 * `@modules/messaging/*` because the underlying writes are messaging-domain
 * (messages, channels).
 */

import type { AgentTool } from '@vobase/core'

import { bookSlotTool } from './book-slot'
import { replyTool } from './reply'
import { sendCardTool } from './send-card'
import { sendFileTool } from './send-file'

export { bookSlotTool, replyTool, sendCardTool, sendFileTool }

export const conversationTools: AgentTool[] = [replyTool, sendCardTool, sendFileTool, bookSlotTool]
