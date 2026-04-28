/**
 * Standalone-lane wake-config assembly. Standalone wakes are NOT conversation-bound —
 * they fire from `agent_threads` (staff posting in the right-rail chat) or
 * from cron heartbeats (scheduled review-and-plan flows). Both produce a wake
 * over the org's full virtual filesystem with a different RO frame, a
 * different side-load (no transcript, no contact block), and different tool
 * surface (`update_contact`, `add_note`, `create_schedule`, …).
 *
 * Synthetic conversationId: BaseEvent requires a string, so standalone wakes
 * use `operator-<threadId>` / `heartbeat-<scheduleId>`. The journal stays
 * queryable; consumers that need to distinguish standalone events filter on
 * the prefix.
 */

import { buildAuthLookup } from '@auth/lookup'
import * as agentsModule from '@modules/agents/agent'
import type { WakeTrigger } from '@modules/agents/events'
import type { AgentDefinition } from '@modules/agents/schema'
import * as syntheticIds from '@modules/agents/service/synthetic-ids'
import { buildStandaloneReadOnlyConfig, conversationVerbs, driveVerbs, teamVerbs } from '@modules/agents/workspace'
import { createStandaloneWorkspace } from '@modules/agents/workspace/create-standalone-workspace'
import * as driveModule from '@modules/drive/agent'
import { filesServiceFor } from '@modules/drive/service/files'
import * as teamModule from '@modules/team/agent'
import type { AgentContributions, SideLoadContributor, WakeRuntime, WorkspaceMaterializer } from '@vobase/core'
import { DirtyTracker, journalGetLastWakeTail, type OnEventListener } from '@vobase/core'
import { nanoid } from 'nanoid'

import { resolveCapability } from '../capability'
import { buildFrozenPrompt } from '../frozen-prompt-builder'
import { createModel, resolveApiKey } from '../llm-provider'
import { setupMessageHistory } from '../message-history'
import {
  type BaseWakeDeps,
  buildIndexFileMaterializer,
  buildJournalAdapter,
  buildSseListener,
  composeHooks,
  resolveStaffIdsForOrg,
} from './base'
import type { WakeConfig } from './conversation'

export type StandaloneTriggerKind = 'operator_thread' | 'heartbeat'

export interface BuildStandaloneWakeConfigInput {
  data: {
    organizationId: string
    triggerKind: StandaloneTriggerKind
    /** For 'operator_thread' wakes. Required when triggerKind === 'operator_thread'. */
    threadId?: string
    /** Verbatim staff message that woke the standalone agent. Surfaces in side-load. */
    threadMessage?: string
    /** For 'heartbeat' wakes. Required when triggerKind === 'heartbeat'. */
    scheduleId?: string
    /** For 'heartbeat' wakes. Pinned at trigger time so retries are deterministic. */
    intendedRunAt?: Date
    /** For 'heartbeat' wakes. Free-form description. */
    reason?: string
  }
  agentId: string
  agentDefinition: AgentDefinition
  contributions: AgentContributions
  deps: BaseWakeDeps
}

/**
 * Synthetic conversationId derived from the wake target. Re-exported from the
 * shared `synthetic-ids` module so frontend (workspace tree / layout) and
 * backend (this build config) read from one source of truth.
 */
export function standaloneConversationId(input: BuildStandaloneWakeConfigInput['data']): string {
  if (input.triggerKind === 'operator_thread') {
    if (!input.threadId) throw new Error('standaloneConversationId: threadId required for operator_thread wake')
    return syntheticIds.operatorConversationId({ triggerKind: 'operator_thread', threadId: input.threadId })
  }
  if (!input.scheduleId) throw new Error('standaloneConversationId: scheduleId required for heartbeat wake')
  return syntheticIds.operatorConversationId({ triggerKind: 'heartbeat', scheduleId: input.scheduleId })
}

/**
 * Build the standalone-lane wake config. Mirrors the conversation-lane body but
 * skips every conversation-bound piece: no `resolveSessionContext`, no
 * messaging materializers, no `conversationSideLoad`, no idle-resumption
 * contributor.
 */
export async function buildStandaloneWakeConfig(input: BuildStandaloneWakeConfigInput): Promise<WakeConfig> {
  const { data, agentId, agentDefinition, contributions, deps } = input
  const conversationId = standaloneConversationId(data)
  const wakeId = nanoid(10)

  const drive = filesServiceFor(data.organizationId)
  const staffIds = await resolveStaffIdsForOrg(data.organizationId)
  const authLookup = buildAuthLookup(deps.db)

  const roConfig = buildStandaloneReadOnlyConfig({ agentId, staffIds })

  const allCommands = [...teamVerbs, ...conversationVerbs, ...driveVerbs]
  const wakeMaterializers: WorkspaceMaterializer[] = [
    ...agentsModule.buildMaterializers({ agentId, agentDefinition, commands: allCommands }),
    ...driveModule.buildMaterializers({ drive }),
    ...teamModule.buildMaterializers({
      organizationId: data.organizationId,
      agentId,
      staffIds,
      authLookup,
    }),
    buildIndexFileMaterializer({ organizationId: data.organizationId }),
    ...contributions.materializers,
  ]

  const workspace = await createStandaloneWorkspace({
    organizationId: data.organizationId,
    agentId,
    conversationId,
    wakeId,
    agentDefinition,
    commands: allCommands,
    materializers: wakeMaterializers,
    drivePort: drive,
    readOnlyConfig: roConfig,
  })

  const frozen = await buildFrozenPrompt({
    bash: workspace.bash,
    agentDefinition,
    organizationId: data.organizationId,
    contactId: '',
    channelInstanceId: '',
  })

  const dirtyTracker = new DirtyTracker(workspace.initialSnapshot, roConfig.writablePrefixes, [...roConfig.memoryPaths])
  const workspaceSyncListener = agentsModule.createWorkspaceSyncListener({
    fs: workspace.innerFs,
    tracker: dirtyTracker,
    organizationId: data.organizationId,
    agentId,
    contactId: '',
    drive,
    logger: deps.logger,
  })

  const history = await setupMessageHistory({ db: deps.db, agentId, conversationId })

  const trigger: WakeTrigger = buildStandaloneTrigger(data)
  const capability = resolveCapability(trigger.trigger)

  const sseListener = buildSseListener({ logPrefix: capability.logPrefix, realtime: null })

  const standaloneBriefSideLoad: SideLoadContributor = (_ctx) =>
    Promise.resolve([
      {
        kind: 'custom',
        priority: 100,
        render: () => renderStandaloneBrief(data),
      },
    ])

  const model = createModel(agentDefinition.model)

  return {
    organizationId: data.organizationId,
    agentId,
    contactId: '',
    conversationId,

    agentDefinition: {
      model: agentDefinition.model,
      instructions: agentDefinition.instructions,
      workingMemory: agentDefinition.workingMemory,
    },
    model,
    getApiKey: () => resolveApiKey(model),

    systemPrompt: frozen.system,
    systemHash: frozen.systemHash,

    trigger,
    triggerKind: trigger.trigger,
    renderTrigger: (t: WakeTrigger | undefined) => (t ? capability.render(t, {}) : 'Standalone wake (no trigger).'),

    workspace: { bash: workspace.bash, innerFs: workspace.innerFs },
    runtime: { fs: workspace.innerFs, tracker: dirtyTracker } satisfies WakeRuntime,

    ...composeHooks({
      capability,
      contributions,
      coreListeners: [sseListener, workspaceSyncListener as OnEventListener<WakeTrigger>],
    }),
    materializers: wakeMaterializers,
    sideLoadContributors: [standaloneBriefSideLoad, ...contributions.sideLoad],
    commands: allCommands,

    extraCustomSideLoad: [],
    agentsMdChain: {},

    getLastWakeTail: journalGetLastWakeTail,
    journalAppend: buildJournalAdapter(),
    loadMessageHistory: history.loadMessageHistory,
    onTurnEndSnapshot: history.onTurnEndSnapshot,

    maxTurns: 10,
    logger: deps.logger,
  }
}

function buildStandaloneTrigger(data: BuildStandaloneWakeConfigInput['data']): WakeTrigger {
  if (data.triggerKind === 'operator_thread') {
    if (!data.threadId) throw new Error('operator wake: threadId required')
    return { trigger: 'operator_thread', threadId: data.threadId, messageIds: [] }
  }
  if (!data.scheduleId || !data.intendedRunAt) {
    throw new Error('heartbeat wake: scheduleId + intendedRunAt required')
  }
  return {
    trigger: 'heartbeat',
    scheduleId: data.scheduleId,
    intendedRunAt: data.intendedRunAt,
    reason: data.reason ?? 'scheduled heartbeat',
  }
}

function renderStandaloneBrief(data: BuildStandaloneWakeConfigInput['data']): string {
  const lines: string[] = ['# Operator Brief', '']
  if (data.triggerKind === 'operator_thread') {
    lines.push(
      'You were woken by a staff message in your operator thread.',
      '',
      'Read the message, decide what action it implies, and either reply via the thread (your assistant message goes back to staff) or call one of the operator tools (`update_contact`, `add_note`, `create_schedule`, `pause_schedule`, `summarize_inbox`, `draft_email_to_review`, `propose_outreach`).',
      '',
    )
    if (data.threadMessage) {
      lines.push('## Latest staff message', '', data.threadMessage, '')
    }
  } else {
    lines.push(
      `You were woken by your **${data.reason ?? 'scheduled'}** heartbeat.`,
      '',
      'This is a review-and-plan run. Survey the org via `summarize_inbox`, scan `/INDEX.md`, decide if any drafts/outreach are warranted, and produce a brief written summary in your MEMORY.md or skills folder when done.',
      '',
    )
  }
  lines.push(
    '## Tool guidance',
    '',
    '- `summarize_inbox` for org snapshots — read-only, cheap.',
    '- `update_contact` for CRM-style edits the staff explicitly requested.',
    '- `add_note` to leave breadcrumbs on a customer conversation timeline.',
    '- `create_schedule` / `pause_schedule` for recurring work.',
    '- `draft_email_to_review` and `propose_outreach` queue for staff approval — nothing sends until they approve.',
  )
  return lines.join('\n')
}
