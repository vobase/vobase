/**
 * Agent-facing surfaces for the messaging module.
 *
 * `tools` is static (all four messaging tools — reply, send_card, send_file,
 * book_slot) and reaches the harness via `collectAgentContributions`.
 *
 * Materializers are dynamic (paths depend on `channelInstanceId` resolved per
 * wake) — expose `buildMaterializers` as a factory that the wake handler calls
 * with the runtime identity. No listeners, commands, or sideLoad contributions
 * today.
 */

import type { AgentTool } from '@vobase/core'

import { messagingTools } from './tools'

export { buildMessagingMaterializers as buildMaterializers } from './materializers'

export const tools: AgentTool[] = [...messagingTools]
