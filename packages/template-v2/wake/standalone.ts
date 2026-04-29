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
import type { AgentDefinition } from '@modules/agents/schema'
import { getCliRegistry } from '@modules/agents/service/cli-registry'
import * as syntheticIds from '@modules/agents/service/synthetic-ids'
import { threads as threadsApi } from '@modules/agents/service/threads'
import { filesServiceFor } from '@modules/drive/service/files'
import type { AgentContributions, SideLoadContributor, WakeRuntime } from '@vobase/core'
import { DirtyTracker, journalGetLastWakeTail, type OnEventListener } from '@vobase/core'
import { nanoid } from 'nanoid'

import {
  type BaseWakeDeps,
  buildIndexFileMaterializer,
  buildJournalAdapter,
  buildSseListener,
  composeHooks,
  resolveStaffIdsForOrg,
} from './build-base'
import type { WakeContext } from './context'
import type { WakeConfig } from './conversation'
import type { WakeTrigger } from './events'
import { createModel, resolveApiKey } from './llm'
import { setupMessageHistory } from './message-history'
import { createWorkspaceSyncListener } from './observers/workspace-sync'
import { buildFrozenPrompt } from './prompt'
import { resolveTriggerSpec } from './trigger'
import { buildStandaloneReadOnlyConfig, createWorkspace } from './workspace'

export type StandaloneTriggerKind = 'operator_thread' | 'heartbeat'

export interface StandaloneWakeConfigInput {
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
  contributions: AgentContributions<WakeContext>
  deps: BaseWakeDeps
}

/**
 * Synthetic conversationId derived from the wake target. Re-exported from the
 * shared `synthetic-ids` module so frontend (workspace tree / layout) and
 * backend (this build config) read from one source of truth.
 */
export function standaloneConversationId(input: StandaloneWakeConfigInput['data']): string {
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
export async function standaloneWakeConfig(input: StandaloneWakeConfigInput): Promise<WakeConfig> {
  const { data, agentId, agentDefinition, contributions, deps } = input
  const conversationId = standaloneConversationId(data)
  const wakeId = nanoid(10)

  const drive = filesServiceFor(data.organizationId)
  const staffIds = await resolveStaffIdsForOrg(data.organizationId)
  const authLookup = buildAuthLookup(deps.db)

  const roConfig = buildStandaloneReadOnlyConfig({ agentId, staffIds, roHints: contributions.roHints })

  // Standalone-lane catalogue — tools opt in via their `lane` field
  // (`'standalone'` or `'both'`). The wake harness never sees customer-facing
  // tools here because no standalone tool tags itself with that lane.
  const laneTools = contributions.tools.filter((t) => t.lane === 'standalone' || t.lane === 'both')

  const wakeCtx: WakeContext = {
    organizationId: data.organizationId,
    agentId,
    conversationId,
    drive,
    staffIds,
    authLookup,
    agentDefinition,
    tools: laneTools,
    agentsMdContributors: contributions.agentsMd,
  }

  const wakeMaterializers = [
    ...contributions.materializers.flatMap((f) => f(wakeCtx)),
    buildIndexFileMaterializer({ organizationId: data.organizationId }),
  ]

  const workspace = await createWorkspace({
    lane: 'standalone',
    organizationId: data.organizationId,
    agentId,
    contactId: '',
    channelInstanceId: '',
    conversationId,
    wakeId,
    agentDefinition,
    registry: getCliRegistry(),
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
  const workspaceSyncListener = createWorkspaceSyncListener({
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
  const capability = resolveTriggerSpec(trigger.trigger)

  const sseListener = buildSseListener({ logPrefix: capability.logPrefix, realtime: null })

  // Operator-thread bridge: mirror the agent's terminal text reply into
  // `agent_thread_messages` so the staff-facing operator chat UI displays it.
  // Without this the harness journal (`harness.messages`) carries the reply
  // but the right-rail / full-page chat reads only `agent_thread_messages`
  // and the thread looks dead. Heartbeat wakes are intentionally excluded:
  // they have no `agent_threads` row to write into.
  //
  // Filter on `role === 'assistant'` + non-empty `content` so tool-call-only
  // turns (which the harness also emits as `message_end`) don't surface in
  // the operator transcript as empty bubbles.
  const operatorThreadBridgeListener: OnEventListener<WakeTrigger> | null =
    data.triggerKind === 'operator_thread' && data.threadId
      ? (() => {
          const threadId = data.threadId
          return async (event) => {
            if (event.type !== 'message_end') return
            const ev = event as { type: 'message_end'; role?: string; content?: string }
            if (ev.role !== 'assistant') return
            const content = (ev.content ?? '').trim()
            if (!content) return
            try {
              await threadsApi.appendMessage({ threadId, role: 'assistant', content })
            } catch (err) {
              console.error('[wake:solo] operator-thread bridge appendMessage failed:', err)
            }
          }
        })()
      : null

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
      laneTools,
      contributions,
      coreListeners: [
        sseListener,
        workspaceSyncListener as OnEventListener<WakeTrigger>,
        ...(operatorThreadBridgeListener ? [operatorThreadBridgeListener] : []),
      ],
    }),
    materializers: wakeMaterializers,
    sideLoadContributors: [standaloneBriefSideLoad, ...contributions.sideLoad],

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

function buildStandaloneTrigger(data: StandaloneWakeConfigInput['data']): WakeTrigger {
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

function renderStandaloneBrief(data: StandaloneWakeConfigInput['data']): string {
  const lines: string[] = ['# Operator Brief', '']
  if (data.triggerKind === 'operator_thread') {
    lines.push(
      'You were woken by a staff message in your operator thread.',
      '',
      'Read the message, decide what action it implies, and either reply via the thread (your assistant message goes back to staff) or call one of the operator tools. Per-tool guidance is in your AGENTS.md `## Tool guidance` section.',
    )
    if (data.threadMessage) {
      lines.push('', '## Latest staff message', '', data.threadMessage)
    }
  } else {
    lines.push(
      `You were woken by your **${data.reason ?? 'scheduled'}** heartbeat.`,
      '',
      'This is a review-and-plan run. Survey the org via `summarize_inbox`, scan `/INDEX.md`, decide if any drafts/outreach are warranted, and produce a brief written summary in your MEMORY.md or skills folder when done.',
    )
  }
  return lines.join('\n')
}
