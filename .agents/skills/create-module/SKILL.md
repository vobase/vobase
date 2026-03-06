---
name: create-module
description: Scaffold a new Vobase business module with schema, routes, jobs, and pages
disable-model-invocation: true
arguments:
  - name: module-name
    description: Lowercase hyphenated module name (e.g. "sales-orders")
    required: true
---

# Create Module

Scaffold a new Vobase module following established conventions.

## Constraints

- Module names: lowercase alphanumeric + hyphens only (`/^[a-z0-9-]+$/`)
- Reserved names: `auth`, `mcp`, `health`, `api`, `system`
- Schema must be a non-empty object of Drizzle table definitions
- Routes must be a Hono router instance
- Money fields: use `integer` (cents), never float
- Status fields: use explicit string enums
- All mutations should be auditable

## Steps

1. **Create module directory** at `src/modules/{module-name}/`

2. **Create schema** (`schema.ts`):
   ```ts
   import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
   import { nanoid } from '@vobase/core';

   export const {tableName} = sqliteTable('{table_name}', {
     id: text('id').primaryKey().$defaultFn(nanoid),
     // Add domain columns here
     createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
   });
   ```

3. **Create routes** (`routes.ts`):
   ```ts
   import { Hono } from 'hono';
   import { getCtx } from '@vobase/core';
   import { eq } from 'drizzle-orm';
   import { {tableName} } from './schema';

   const routes = new Hono();

   routes.get('/', async (c) => {
     const { db } = getCtx(c);
     const items = await db.select().from({tableName});
     return c.json(items);
   });

   export { routes };
   ```

4. **Create module definition** (`index.ts`):
   ```ts
   import { defineModule } from '@vobase/core';
   import * as schema from './schema';
   import { routes } from './routes';

   export const {moduleName}Module = defineModule({
     name: '{module-name}',
     schema,
     routes,
   });
   ```

5. **Register the module** in the app's module list (typically `server.ts` or `app.ts`).

6. **Sync schema**: Remind user to run `bunx drizzle-kit push` (dev) or generate a migration.

## Optional additions

- **Jobs**: Create `jobs.ts` with `JobDefinition[]` and add to `defineModule({ jobs })`.
- **Pages**: Add `pages` record mapping route paths to component paths.
- **Seed**: Add `seed` async function for dev data.
