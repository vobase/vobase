/**
 * Concierge-only tools. Customer-facing dispatches: `reply`, `send_card`,
 * `send_file`, `book_slot`. Imported by the concierge wake-config and
 * exported as `conciergeTools` so the agent contributions registry can
 * pick them up at boot.
 *
 * These tools live here (not in messaging) for the same reason `operatorTools`
 * lives in `tools/operator/` — role partitions the tool catalogue per the
 * dual-surface convention. Service imports still cross into `@modules/messaging/*`
 * because the underlying writes are messaging-domain (messages, channels).
 */

import type { AgentTool } from '@vobase/core'

import { bookSlotTool } from './book-slot'
import { replyTool } from './reply'
import { sendCardTool } from './send-card'
import { sendFileTool } from './send-file'

export { bookSlotTool, replyTool, sendCardTool, sendFileTool }

export const conciergeTools: AgentTool[] = [replyTool, sendCardTool, sendFileTool, bookSlotTool]
