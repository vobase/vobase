import { Hono } from 'hono';

import { agentsHandlers } from './handlers/agents';
import { channelsHandlers } from './handlers/channels';
import { chatHandlers } from './handlers/chat';
import { contactsHandlers } from './handlers/contacts';
import { contactsTableHandlers } from './handlers/contacts-table';
import { sessionsHandlers } from './handlers/sessions';
import { sessionsTableHandlers } from './handlers/sessions-table';
import { statsHandlers } from './handlers/stats';

export const conversationsRoutes = new Hono()
  .route('/', chatHandlers)
  .route('/', sessionsHandlers)
  .route('/', agentsHandlers)
  .route('/', statsHandlers)
  .route('/', channelsHandlers)
  .route('/contacts', contactsHandlers)
  .route('/contacts-table', contactsTableHandlers)
  .route('/sessions-table', sessionsTableHandlers);

export type ConversationsRoutes = typeof conversationsRoutes;
