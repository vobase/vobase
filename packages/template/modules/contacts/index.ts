import { defineModule } from '@vobase/core';

import { contactsRoutes } from './handlers';
import * as schema from './schema';

export const contactsModule = defineModule({
  name: 'contacts',
  schema,
  routes: contactsRoutes,
  jobs: [],
});
