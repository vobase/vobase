import { Hono } from 'hono';

import { agentsHandlers } from './handlers/agents';
import { chatHandlers } from './handlers/chat';
import { dashboardHandlers } from './handlers/dashboard';
import { evalsHandlers } from './handlers/evals';
import { guardrailsHandlers } from './handlers/guardrails';
import { mcpHandlers } from './handlers/mcp';
import { metricsHandlers } from './handlers/metrics';
import { statsHandlers } from './handlers/stats';

export const agentsRoutes = new Hono()
  .route('/', chatHandlers)
  .route('/', agentsHandlers)
  .route('/', statsHandlers)
  .route('/', dashboardHandlers)
  .route('/', metricsHandlers)
  .route('/', evalsHandlers)
  .route('/', guardrailsHandlers)
  .route('/', mcpHandlers);

export type AgentsRoutes = typeof agentsRoutes;
