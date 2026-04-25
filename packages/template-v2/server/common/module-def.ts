/**
 * Project-local `ModuleDef` type alias — binds the generic core contract to
 * this template's concrete `ScopedDb` and `RealtimeService` types so module
 * authors can write `init(ctx) { ctx.db.select(...) }` without manual
 * generic narrowing.
 *
 * Boot loop, dependency sorter, and collectors live in `@vobase/core` and
 * are imported directly from there.
 */

import type { RealtimeService } from '@server/common/port-types'
import type { ScopedDb } from '@server/common/scoped-db'
import type { ModuleDef as CoreModuleDef, ModuleInitCtx as CoreModuleInitCtx } from '@vobase/core'

export type ModuleInitCtx = CoreModuleInitCtx<ScopedDb, RealtimeService>
export type ModuleDef = CoreModuleDef<ScopedDb, RealtimeService>
