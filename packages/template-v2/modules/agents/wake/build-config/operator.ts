/**
 * Operator wake-config assembly. Operator wakes are NOT conversation-bound —
 * they fire from `agent_threads` (staff posting in the right-rail chat) or
 * from cron heartbeats (scheduled review-and-plan flows). Both produce a wake
 * over the org's full virtual filesystem with a different RO frame, a
 * different side-load (no transcript, no contact block), and different tool
 * surface (`update_contact`, `add_note`, `create_schedule`, …).
 *
 * Synthetic conversationId: BaseEvent requires a string, so operator wakes
 * use `operator-<threadId>` / `heartbeat-<scheduleId>`. The journal stays
 * queryable; consumers that need to distinguish operator events filter on
 * the prefix.
 */

import { buildAuthLookup } from '@auth/lookup'
import * as agentsModule from '@modules/agents/agent'
import type { AgentEvent, WakeTrigger } from '@modules/agents/events'
import type { AgentDefinition } from '@modules/agents/schema'
import { operatorTools } from '@modules/agents/tools/operator'
import { buildOperatorReadOnlyConfig, conversationVerbs, driveVerbs, teamVerbs } from '@modules/agents/workspace'
import { createOperatorWorkspace } from '@modules/agents/workspace/create-operator-workspace'
import * as driveModule from '@modules/drive/agent'
import { filesServiceFor } from '@modules/drive/service/files'
import * as teamModule from '@modules/team/agent'
import type {
  AgentContributions,
  AgentTool,
  SideLoadContributor,
  WakeRuntime,
  WorkspaceMaterializer,
} from '@vobase/core'
import { DirtyTracker, journalAppend, journalGetLastWakeTail, type OnEventListener } from '@vobase/core'
import { nanoid } from 'nanoid'

import { buildFrozenPrompt } from '../frozen-prompt-builder'
import type { LlmEmitter } from '../llm-call'
import { createModel, resolveApiKey } from '../llm-provider'
import { setupMessageHistory } from '../message-history'
import { type BaseWakeDeps, buildIndexFileMaterializer, resolveStaffIdsForOrg } from './base'
import type { WakeConfig } from './concierge'

export type OperatorTriggerKind = 'operator_thread' | 'heartbeat'

export interface BuildOperatorWakeConfigInput {
  data: {
    organizationId: string
    triggerKind: OperatorTriggerKind
    /** For 'operator_thread' wakes. Required when triggerKind === 'operator_thread'. */
    threadId?: string
    /** Verbatim staff message that woke the operator. Surfaces in side-load. */
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

/** Synthetic conversationId derived from the wake target. */
export function operatorConversationId(input: BuildOperatorWakeConfigInput['data']): string {
  if (input.triggerKind === 'operator_thread') {
    if (!input.threadId) throw new Error('operatorConversationId: threadId required for operator_thread wake')
    return `operator-${input.threadId}`
  }
  if (!input.scheduleId) throw new Error('operatorConversationId: scheduleId required for heartbeat wake')
  return `heartbeat-${input.scheduleId}`
}

/**
 * Build the operator-flavoured wake config. Mirrors the concierge body but
 * skips every conversation-bound piece: no `resolveSessionContext`, no
 * messaging materializers, no `conversationSideLoad`, no idle-resumption
 * contributor.
 */
export async function buildOperatorWakeConfig(input: BuildOperatorWakeConfigInput): Promise<WakeConfig> {
  const { data, agentId, agentDefinition, contributions, deps } = input
  const conversationId = operatorConversationId(data)
  const wakeId = nanoid(10)

  const drive = filesServiceFor(data.organizationId)
  const staffIds = await resolveStaffIdsForOrg(data.organizationId)
  const authLookup = buildAuthLookup(deps.db)

  const roConfig = buildOperatorReadOnlyConfig({ agentId, staffIds })

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

  const workspace = await createOperatorWorkspace({
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

  const emitEventHandle: LlmEmitter = {}

  const history = await setupMessageHistory({ db: deps.db, agentId, conversationId })

  const sseListener: OnEventListener<WakeTrigger> = (event) => {
    const anyEv = event as unknown as Record<string, unknown>
    const detail = anyEv.toolName ? ` tool=${anyEv.toolName}` : ''
    const reason = anyEv.reason ? ` reason=${anyEv.reason}` : ''
    const text = anyEv.textDelta ? ` text=${String(anyEv.textDelta).slice(0, 80)}` : ''
    const args = anyEv.args ? ` args=${JSON.stringify(anyEv.args).slice(0, 200)}` : ''
    const result = anyEv.result ? ` result=${JSON.stringify(anyEv.result).slice(0, 200)}` : ''
    const isError = anyEv.isError ? ' ERROR' : ''
    console.log(`[op-wake] ${event.type} turn=${event.turnIndex}${detail}${reason}${text}${args}${isError}${result}`)
  }

  const trigger: WakeTrigger = buildOperatorTrigger(data)
  const tools: readonly AgentTool[] = [...operatorTools, ...(contributions.tools as readonly AgentTool[])]
  const operatorBriefSideLoad: SideLoadContributor = (_ctx) =>
    Promise.resolve([
      {
        kind: 'custom',
        priority: 100,
        render: () => renderOperatorBrief(data),
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
    renderTrigger: (t: WakeTrigger | undefined) => renderOperatorTriggerMessage(t),

    workspace: { bash: workspace.bash, innerFs: workspace.innerFs },
    runtime: { fs: workspace.innerFs, tracker: dirtyTracker } satisfies WakeRuntime,

    tools,
    hooks: {
      on_event: [
        sseListener,
        workspaceSyncListener as OnEventListener<WakeTrigger>,
        ...((contributions.listeners.on_event ?? []) as readonly OnEventListener<WakeTrigger>[]),
      ],
      ...(contributions.listeners.on_tool_call ? { on_tool_call: contributions.listeners.on_tool_call } : {}),
      ...(contributions.listeners.on_tool_result ? { on_tool_result: contributions.listeners.on_tool_result } : {}),
    },
    materializers: wakeMaterializers,
    sideLoadContributors: [operatorBriefSideLoad, ...contributions.sideLoad],
    commands: allCommands,

    extraCustomSideLoad: [],
    agentsMdChain: {},

    getLastWakeTail: journalGetLastWakeTail,
    journalAppend: async (ev) => {
      const ae = ev as unknown as AgentEvent & {
        conversationId: string
        organizationId: string
        wakeId?: string
        turnIndex?: number
      }
      await journalAppend({
        conversationId: ae.conversationId,
        organizationId: ae.organizationId,
        wakeId: ae.wakeId ?? null,
        turnIndex: ae.turnIndex ?? 0,
        event: ae,
      })
    },
    loadMessageHistory: history.loadMessageHistory,
    onTurnEndSnapshot: history.onTurnEndSnapshot,

    onPublishReady: (publish) => {
      emitEventHandle.emit = publish
    },

    maxTurns: 10,
    logger: deps.logger,
  }
}

function buildOperatorTrigger(data: BuildOperatorWakeConfigInput['data']): WakeTrigger {
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

function renderOperatorTriggerMessage(trigger: WakeTrigger | undefined): string {
  if (!trigger) return 'Operator wake (no trigger).'
  switch (trigger.trigger) {
    case 'operator_thread':
      return 'A staff member posted in your operator thread. Read the latest message and respond or act.'
    case 'heartbeat':
      return `Heartbeat (${trigger.reason}) at ${trigger.intendedRunAt.toISOString()}. Run your review-and-plan flow.`
    default:
      // Concierge triggers should never reach here.
      return `Operator wake misrouted: ${trigger.trigger}.`
  }
}

function renderOperatorBrief(data: BuildOperatorWakeConfigInput['data']): string {
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
