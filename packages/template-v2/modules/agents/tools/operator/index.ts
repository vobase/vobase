/**
 * Operator-only tools. Imported by the operator wake-config (lands in §10.6)
 * and re-exported as `operatorTools` so the agent contributions registry
 * picks them up at boot.
 */

import type { AgentTool } from '@vobase/core'

import { addNoteTool } from './add-note'
import { createScheduleTool } from './create-schedule'
import { draftEmailToReviewTool } from './draft-email-to-review'
import { pauseScheduleTool } from './pause-schedule'
import { proposeOutreachTool } from './propose-outreach'
import { summarizeInboxTool } from './summarize-inbox'
import { updateContactTool } from './update-contact'

export const operatorTools: AgentTool[] = [
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
