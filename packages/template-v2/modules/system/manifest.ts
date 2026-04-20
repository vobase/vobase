import type { ModuleManifest } from '@server/runtime/define-module'

export const manifest: ModuleManifest = {
  provides: {
    commands: ['system:info', 'system:health', 'system:audit-log', 'system:sequences'],
  },
  permissions: [],
}
