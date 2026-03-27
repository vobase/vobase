import { Hono } from 'hono';

import { activityHandlers } from './handlers/activity';
import { agentsHandlers } from './handlers/agents';
import { attentionHandlers } from './handlers/attention';
import { channelsHandlers } from './handlers/channels';
import { chatHandlers } from './handlers/chat';
import { contactsHandlers } from './handlers/contacts';
import { contactsTableHandlers } from './handlers/contacts-table';
import { dashboardHandlers } from './handlers/dashboard';
import { metricsHandlers } from './handlers/metrics';
import { conversationsDetailHandlers } from './handlers/sessions';
import { conversationsTableHandlers } from './handlers/sessions-table';
import { statsHandlers } from './handlers/stats';

export const conversationsRoutes = new Hono()
  .route('/', chatHandlers)
  .route('/', conversationsDetailHandlers)
  .route('/', agentsHandlers)
  .route('/', statsHandlers)
  .route('/', channelsHandlers)
  .route('/', activityHandlers)
  .route('/', attentionHandlers)
  .route('/', dashboardHandlers)
  .route('/', metricsHandlers)
  .route('/contacts', contactsHandlers)
  .route('/contacts-table', contactsTableHandlers)
  .route('/conversations-table', conversationsTableHandlers);

export type ConversationsRoutes = typeof conversationsRoutes;
