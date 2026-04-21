import type { ModuleManifest } from '@server/runtime/define-module'

export const manifest: ModuleManifest = {
  provides: {
    commands: ['contacts:get', 'contacts:list', 'contacts:search'],
    materializers: ['contactProfileMaterializer', 'contactMemoryMaterializer'],
  },
  permissions: [],
  workspace: { owns: [] },
}
