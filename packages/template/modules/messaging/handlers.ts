import { Hono } from 'hono';

import { activityHandlers } from './handlers/activity';
import { attributeDefinitionsHandlers } from './handlers/attribute-definitions';
import { automationHandlers } from './handlers/automation';
import { broadcastsHandlers } from './handlers/broadcasts';
import { channelsHandlers } from './handlers/channels';
import { contactsHandlers } from './handlers/contacts';
import { conversationsDetailHandlers } from './handlers/conversations';
import { labelsHandlers } from './handlers/labels';
import { teamMembersHandlers } from './handlers/team-members';
import { templatesHandlers } from './handlers/templates';

export const messagingRoutes = new Hono()
  .route('/', labelsHandlers)
  .route('/', conversationsDetailHandlers)
  .route('/', channelsHandlers)
  .route('/', activityHandlers)
  .route('/', templatesHandlers)
  .route('/', teamMembersHandlers)
  .route('/contacts', contactsHandlers)
  .route('/broadcasts', broadcastsHandlers)
  .route('/automation', automationHandlers)
  .route('/attribute-definitions', attributeDefinitionsHandlers);

export type MessagingRoutes = typeof messagingRoutes;
