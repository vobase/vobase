import type { AgentTool } from '@vobase/core'

import { bookSlotTool } from './book-slot'
import { replyTool } from './reply'
import { sendCardTool } from './send-card'
import { sendFileTool } from './send-file'

export { bookSlotTool } from './book-slot'
export { replyTool } from './reply'
export { sendCardTool } from './send-card'
export { sendFileTool } from './send-file'

export const messagingTools: AgentTool[] = [replyTool, sendCardTool, sendFileTool, bookSlotTool]
