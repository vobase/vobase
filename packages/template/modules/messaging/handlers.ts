import { Hono } from 'hono';

import { activityHandlers } from './handlers/activity';
import { channelsHandlers } from './handlers/channels';
import { contactsHandlers } from './handlers/contacts';
import { conversationsDetailHandlers } from './handlers/conversations';
import { labelsHandlers } from './handlers/labels';
import { templatesHandlers } from './handlers/templates';

export const messagingRoutes = new Hono()
  .route('/', labelsHandlers)
  .route('/', conversationsDetailHandlers)
  .route('/', channelsHandlers)
  .route('/', activityHandlers)
  .route('/', templatesHandlers)
  .route('/contacts', contactsHandlers);

export type MessagingRoutes = typeof messagingRoutes;
