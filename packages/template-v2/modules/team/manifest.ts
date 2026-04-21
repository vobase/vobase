import type { ModuleManifest } from '@server/runtime/define-module'

export const manifest: ModuleManifest = {
  provides: {
    commands: ['team:staff:list', 'team:staff:get'],
  },
  permissions: [],
  workspace: { owns: [] },
}
