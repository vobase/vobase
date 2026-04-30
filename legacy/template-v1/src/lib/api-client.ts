import { hc } from 'hono/client'

import type { AgentsRoutes } from '../../modules/agents/handlers'
import type { AutomationRoutes } from '../../modules/automation/handlers'
import type { KnowledgeBaseRoutes } from '../../modules/knowledge-base/handlers'
import type { MessagingRoutes } from '../../modules/messaging/handlers'
import type { SystemRoutes } from '../../modules/system/handlers'

export const systemClient = hc<SystemRoutes>('/api/system')
export const messagingClient = hc<MessagingRoutes>('/api/messaging')
export const agentsClient = hc<AgentsRoutes>('/api/agents')
export const knowledgeBaseClient = hc<KnowledgeBaseRoutes>('/api/knowledge-base')
export const automationClient = hc<AutomationRoutes>('/api/automation')
