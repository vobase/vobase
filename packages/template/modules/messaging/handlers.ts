import { Hono } from 'hono';

import { activityHandlers } from './handlers/activity';
import { channelsHandlers } from './handlers/channels';
import { contactsHandlers } from './handlers/contacts';
import { conversationsDetailHandlers } from './handlers/conversations';
import { labelsHandlers } from './handlers/labels';

export const messagingRoutes = new Hono()
  .route('/', labelsHandlers)
  .route('/', conversationsDetailHandlers)
  .route('/', channelsHandlers)
  .route('/', activityHandlers)
  .route('/contacts', contactsHandlers);

export type MessagingRoutes = typeof messagingRoutes;
