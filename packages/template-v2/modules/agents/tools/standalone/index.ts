/**
 * Standalone-lane tools. Used by wakes that are not bound to a customer
 * conversation — operator-thread (right-rail staff↔agent chat) and heartbeat
 * (scheduled review-and-plan). The capability registry binds these per
 * trigger kind.
 */

import type { AgentTool } from '@vobase/core'

import { addNoteTool } from './add-note'
import { createScheduleTool } from './create-schedule'
import { draftEmailToReviewTool } from './draft-email-to-review'
import { pauseScheduleTool } from './pause-schedule'
import { proposeOutreachTool } from './propose-outreach'
import { summarizeInboxTool } from './summarize-inbox'
import { updateContactTool } from './update-contact'

export const standaloneTools: AgentTool[] = [
  updateContactTool,
  addNoteTool,
  createScheduleTool,
  pauseScheduleTool,
  draftEmailToReviewTool,
  summarizeInboxTool,
  proposeOutreachTool,
]

export {
  addNoteTool,
  createScheduleTool,
  draftEmailToReviewTool,
  pauseScheduleTool,
  proposeOutreachTool,
  summarizeInboxTool,
  updateContactTool,
}
