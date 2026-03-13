import { defineModule } from '@vobase/core';

import { chatbotRoutes } from './handlers';
import * as schema from './schema';

export const chatbotModule = defineModule({
  name: 'chatbot',
  schema,
  routes: chatbotRoutes,
});
