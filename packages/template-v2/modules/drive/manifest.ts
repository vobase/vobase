import type { ModuleManifest } from '@server/runtime/define-module'

export const manifest: ModuleManifest = {
  provides: {
    commands: ['drive:ls', 'drive:cat', 'drive:grep', 'drive:find'],
    materializers: ['businessMdMaterializer', 'driveFolderMaterializer'],
    channels: [],
  },
  permissions: [],
  workspace: {
    owns: [{ kind: 'prefix', path: '/workspace/drive/' }],
    frozenEager: [{ kind: 'exact', path: '/workspace/drive/BUSINESS.md' }],
  },
  tables: ['public.drive_files', 'public.learning_proposals'],
  accessGrants: [
    {
      to: 'agents',
      path: 'service/learning-proposals',
      reason: 'drive proposal builder co-commits a LearningProposal via agents-owned writer',
    },
  ],
}
