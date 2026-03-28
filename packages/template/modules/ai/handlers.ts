import { Hono } from 'hono';

import { activityHandlers } from './handlers/activity';
import { agentsHandlers } from './handlers/agents';
import { attentionHandlers } from './handlers/attention';
import { channelsHandlers } from './handlers/channels';
import { chatHandlers } from './handlers/chat';
import { contactsHandlers } from './handlers/contacts';
import { dashboardHandlers } from './handlers/dashboard';
import { evalsHandlers } from './handlers/evals';
import { guardrailsHandlers } from './handlers/guardrails';
import { mcpHandlers } from './handlers/mcp';
import { memoryHandlers } from './handlers/memory';
import { metricsHandlers } from './handlers/metrics';
import { conversationsDetailHandlers } from './handlers/conversations';
import { statsHandlers } from './handlers/stats';
import { workflowsHandlers } from './handlers/workflows';

export const aiRoutes = new Hono()
  .route('/', chatHandlers)
  .route('/', conversationsDetailHandlers)
  .route('/', agentsHandlers)
  .route('/', statsHandlers)
  .route('/', channelsHandlers)
  .route('/', activityHandlers)
  .route('/', attentionHandlers)
  .route('/', dashboardHandlers)
  .route('/', metricsHandlers)
  .route('/', memoryHandlers)
  .route('/', evalsHandlers)
  .route('/', guardrailsHandlers)
  .route('/', workflowsHandlers)
  .route('/', mcpHandlers)
  .route('/contacts', contactsHandlers);

export type AiRoutes = typeof aiRoutes;
