import type { ModuleManifest } from '@server/runtime/define-module'

export const manifest: ModuleManifest = {
  provides: {
    tools: ['subagent'],
    observers: ['auditObserver', 'sseObserver', 'workspaceSyncObserver', 'scorerObserver', 'memoryDistillObserver'],
    mutators: ['moderationMutator', 'approvalMutator'],
    materializers: ['frozenPromptBuilder', 'sideLoadCollector'],
  },
  permissions: [],
}
