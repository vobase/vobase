/**
 * `views` module — owns `saved_views` (the first declarative-resource
 * consumer) and the generic `views.query` / `views.save` HTTP surface.
 *
 * On init:
 *   1. Register `saved_views` as a declarative resource so the boot
 *      reconciler picks up `modules/<m>/views/*.view.yaml` defaults.
 *   2. Bind the Drizzle table so the reconciler driver can write to it.
 *   3. Install the `ViewsService` for cross-module callers.
 *
 * Viewables (e.g. `object:contacts`) are registered by the modules that own
 * the underlying tables — not here.
 */

import { savedViews } from '@modules/views/schema'
import { createViewsService, installViewsService, savedViewBodySchema } from '@modules/views/service/views'
import { bindDeclarativeTable, defineDeclarativeResource, serializeYaml } from '@vobase/core'

import type { ModuleDef } from '~/runtime'
import * as web from './web'

// Register at module-load time so it's in the declarative registry before
// `bootDeclarativeResources` runs in `runtime/bootstrap.ts`.
defineDeclarativeResource({
  kind: 'saved_views',
  // Source files live next to each module, e.g. modules/contacts/views/default.view.yaml
  sourceGlobs: 'modules/*/views/*.view.yaml',
  format: 'yaml',
  bodySchema: savedViewBodySchema,
  parsePath: (ctx) => {
    // Path like `modules/contacts/views/default.view.yaml`
    const segs = ctx.relPath.split('/')
    const moduleName = segs[1] ?? 'unknown'
    return { slug: ctx.basename, scope: `object:${moduleName}` }
  },
  serialize: (b) => serializeYaml(b),
})

const views: ModuleDef = {
  name: 'views',
  // Views must boot before `agents` so the views service is installed before
  // any wake handler tries to call `query_view` or `save_view` tools.
  requires: ['contacts', 'team'],
  web: { routes: web.routes },
  jobs: [],
  init(ctx) {
    bindDeclarativeTable('saved_views', savedViews)
    installViewsService(createViewsService({ db: ctx.db }))
  },
}

export default views
