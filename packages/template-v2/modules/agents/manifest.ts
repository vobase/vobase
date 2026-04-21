import type { ModuleManifest } from '@server/runtime/define-module'

export const manifest: ModuleManifest = {
  provides: {
    tools: ['subagent'],
    observers: ['agents:audit', 'agents:sse', 'agents:cost-aggregator', 'agents:scorer'],
    mutators: ['agents:moderation'],
    materializers: ['frozenPromptBuilder', 'sideLoadCollector'],
  },
  permissions: [],
  workspace: {
    owns: [
      { kind: 'exact', path: '/workspace/SOUL.md' },
      { kind: 'exact', path: '/workspace/MEMORY.md' },
    ],
    frozenEager: [
      { kind: 'exact', path: '/workspace/SOUL.md' },
      { kind: 'exact', path: '/workspace/MEMORY.md' },
    ],
  },
}
