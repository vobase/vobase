/**
 * Thin re-export barrel.
 *
 * The `ModuleDef` contract, boot loop, and dependency sorter live in
 * `@vobase/core`. Template binds the generic `Db` / `Realtime` parameters to
 * its project-local `ScopedDb` and `RealtimeService` so modules continue to
 * read `ctx.db` / `ctx.realtime` with their concrete types.
 *
 * Slice 4b migrates template imports to `@vobase/core` directly and deletes
 * this file.
 */

import type { RealtimeService } from '@server/common/port-types'
import type { ScopedDb } from '@server/common/scoped-db'
import type { ModuleDef as CoreModuleDef, ModuleInitCtx as CoreModuleInitCtx } from '@vobase/core'

export type ModuleInitCtx = CoreModuleInitCtx<ScopedDb, RealtimeService>
export type ModuleDef = CoreModuleDef<ScopedDb, RealtimeService>

export {
  bootModules,
  bootModulesCollector,
  InvalidModuleError,
  type ModuleRoutes,
  sortModules,
} from '@vobase/core'
