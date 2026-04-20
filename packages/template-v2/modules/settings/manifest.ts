import type { ModuleManifest } from '@server/runtime/define-module'

export const manifest: ModuleManifest = {
  provides: {
    commands: [
      'settings:profile',
      'settings:account',
      'settings:appearance',
      'settings:notifications',
      'settings:display',
      'settings:api-keys',
    ],
  },
  permissions: [],
  workspace: { owns: [] },
  accessGrants: [],
}
