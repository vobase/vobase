/**
 * Concierge wake-config assembly: the `inbound_message` / `supervisor` /
 * `approval_resumed` path that the helpdesk has had since day one. Every
 * concierge wake is conversation-bound — `conv.channelInstanceId` drives the
 * `/contacts/<contactId>/<channelInstanceId>/` materializers, the side-load
 * pulls the rolling transcript, and the trigger renderer points at messages.md
 * for context.
 *
 * Operator wakes (heartbeat, operator-thread) use `./operator.ts` instead;
 * shared building blocks live in `./base.ts`.
 */

import { buildAuthLookup } from '@auth/lookup'
import * as agentsModule from '@modules/agents/agent'
import type { WakeTrigger } from '@modules/agents/events'
import type { AgentDefinition } from '@modules/agents/schema'
import { conciergeTools } from '@modules/agents/tools/concierge'
import { buildDefaultReadOnlyConfig, conversationVerbs, driveVerbs, teamVerbs } from '@modules/agents/workspace'
import { createWorkspace } from '@modules/agents/workspace/create-workspace'
import * as contactsModule from '@modules/contacts/agent'
import { get as getContact, readNotes as readContactNotes } from '@modules/contacts/service/contacts'
import * as driveModule from '@modules/drive/agent'
import { filesServiceFor } from '@modules/drive/service/files'
import * as messagingModule from '@modules/messaging/agent'
import type { Conversation } from '@modules/messaging/schema'
import { list as listMessages } from '@modules/messaging/service/messages'
import { listNotes as listInternalNotes } from '@modules/messaging/service/notes'
import * as teamModule from '@modules/team/agent'
import type { AgentContributions, AgentTool, WakeRuntime, WorkspaceMaterializer } from '@vobase/core'
import {
  conversationEvents,
  createIdleResumptionContributor,
  DirtyTracker,
  journalGetLastWakeTail,
  type OnEventListener,
} from '@vobase/core'
import { desc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'

import { buildFrozenPrompt } from '../frozen-prompt-builder'
import type { LlmEmitter } from '../llm-call'
import { createModel, resolveApiKey } from '../llm-provider'
import { setupMessageHistory } from '../message-history'
import { resolvePlatformHint } from '../platform-hints'
import { resolveSessionContext } from '../session-context'
import {
  type BaseWakeDeps,
  buildIndexFileMaterializer,
  buildJournalAdapter,
  buildSseListener,
  IDLE_RESUMPTION_THRESHOLD_MS,
  resolveStaffIdsForOrg,
} from './base'

export interface BuildWakeConfigInput {
  data: {
    organizationId: string
    conversationId: string
    messageId: string
    contactId: string
  }
  conv: Conversation
  agentId: string
  agentDefinition: AgentDefinition
  contributions: AgentContributions
  deps: BaseWakeDeps
}

export type WakeConfig = Parameters<typeof import('@vobase/core').createHarness<WakeTrigger>>[0]

export async function buildWakeConfig(input: BuildWakeConfigInput): Promise<WakeConfig> {
  const { data, conv, agentId, agentDefinition, contributions, deps } = input

  const channelInstanceId = conv.channelInstanceId
  const conversationId = data.conversationId
  const wakeId = nanoid(10)

  const drive = filesServiceFor(data.organizationId)
  const staffIds = await resolveStaffIdsForOrg(data.organizationId)
  const authLookup = buildAuthLookup(deps.db)

  const roConfig = buildDefaultReadOnlyConfig({
    agentId,
    contactId: data.contactId,
    channelInstanceId,
    staffIds,
  })

  const contactsReader = { get: getContact, readNotes: readContactNotes }
  const messagingReader = { listMessages, listInternalNotes }

  const allCommands = [...teamVerbs, ...conversationVerbs, ...driveVerbs]
  const wakeMaterializers: WorkspaceMaterializer[] = [
    ...agentsModule.buildMaterializers({ agentId, agentDefinition, commands: allCommands }),
    ...driveModule.buildMaterializers({ drive }),
    ...contactsModule.buildMaterializers({ contacts: contactsReader, contactId: data.contactId }),
    ...messagingModule.buildMaterializers({
      messaging: messagingReader,
      contactId: data.contactId,
      channelInstanceId,
    }),
    ...teamModule.buildMaterializers({
      organizationId: data.organizationId,
      agentId,
      staffIds,
      authLookup,
    }),
    buildIndexFileMaterializer({ organizationId: data.organizationId }),
    ...contributions.materializers,
  ]

  const workspace = await createWorkspace({
    organizationId: data.organizationId,
    agentId,
    contactId: data.contactId,
    conversationId,
    channelInstanceId,
    wakeId,
    agentDefinition,
    commands: allCommands,
    materializers: wakeMaterializers,
    drivePort: drive,
    readOnlyConfig: roConfig,
  })

  const sessionContext = await resolveSessionContext({
    db: deps.db,
    conv,
    contactId: data.contactId,
  })
  const platformHint = resolvePlatformHint(sessionContext.channelKind)

  const frozen = await buildFrozenPrompt({
    bash: workspace.bash,
    agentDefinition,
    organizationId: data.organizationId,
    contactId: data.contactId,
    channelInstanceId,
    sessionContext,
    platformHint,
  })

  const dirtyTracker = new DirtyTracker(workspace.initialSnapshot, roConfig.writablePrefixes, [...roConfig.memoryPaths])
  const workspaceSyncListener = agentsModule.createWorkspaceSyncListener({
    fs: workspace.innerFs,
    tracker: dirtyTracker,
    organizationId: data.organizationId,
    agentId,
    contactId: data.contactId,
    drive,
    logger: deps.logger,
  })

  const emitEventHandle: LlmEmitter = {}
  const memoryDistillListener = agentsModule.createMemoryDistillListener({
    target: { kind: 'contact', contactId: data.contactId },
    agentId,
    useLlm: false,
    emitter: emitEventHandle,
    db: deps.db,
    logger: deps.logger,
  })

  const history = await setupMessageHistory({ db: deps.db, agentId, conversationId })

  const sseListener = buildSseListener({
    logPrefix: 'wake',
    realtime: deps.realtime,
    conversationId: data.conversationId,
  })

  const trigger: WakeTrigger = {
    trigger: 'inbound_message',
    conversationId,
    messageIds: [data.messageId],
  }

  const model = createModel(agentDefinition.model)

  return {
    organizationId: data.organizationId,
    agentId,
    contactId: data.contactId,
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
    renderTrigger: (t: WakeTrigger | undefined) =>
      renderTriggerMessage(t, { contactId: data.contactId, channelInstanceId }),

    workspace: { bash: workspace.bash, innerFs: workspace.innerFs },
    runtime: { fs: workspace.innerFs, tracker: dirtyTracker } satisfies WakeRuntime,

    tools: [...conciergeTools, ...(contributions.tools as readonly AgentTool[])] as readonly AgentTool[],
    hooks: {
      on_event: [
        sseListener,
        workspaceSyncListener as OnEventListener<WakeTrigger>,
        memoryDistillListener as OnEventListener<WakeTrigger>,
        ...((contributions.listeners.on_event ?? []) as readonly OnEventListener<WakeTrigger>[]),
      ],
      ...(contributions.listeners.on_tool_call ? { on_tool_call: contributions.listeners.on_tool_call } : {}),
      ...(contributions.listeners.on_tool_result ? { on_tool_result: contributions.listeners.on_tool_result } : {}),
    },
    materializers: wakeMaterializers,
    sideLoadContributors: [messagingModule.conversationSideLoad, ...contributions.sideLoad],
    commands: allCommands,

    extraCustomSideLoad: [
      createIdleResumptionContributor({
        conversationId,
        thresholdMs: IDLE_RESUMPTION_THRESHOLD_MS,
        getLastActivityTime: async (convId) => {
          const rows = await deps.db
            .select({ ts: conversationEvents.ts })
            .from(conversationEvents)
            .where(eq(conversationEvents.conversationId, convId))
            .orderBy(desc(conversationEvents.ts))
            .limit(1)
          return rows.length > 0 ? rows[0].ts : null
        },
      }),
    ],
    agentsMdChain: {},

    getLastWakeTail: journalGetLastWakeTail,
    journalAppend: buildJournalAdapter(),
    loadMessageHistory: history.loadMessageHistory,
    onTurnEndSnapshot: history.onTurnEndSnapshot,

    onPublishReady: (publish) => {
      emitEventHandle.emit = publish
    },

    maxTurns: 10,
    logger: deps.logger,
  }
}

/**
 * Render the trigger message displayed to the agent as a wake-reason cue.
 *
 * `/contacts/<contactId>/<channelInstanceId>/` replaces the legacy
 * `/conversations/<convId>/` folder for messages + internal-notes references.
 */
function renderTriggerMessage(
  trigger: WakeTrigger | undefined,
  refs: { contactId: string; channelInstanceId: string },
): string {
  if (!trigger) return 'Manual wake.'
  const convoFolder = `/contacts/${refs.contactId}/${refs.channelInstanceId}`
  switch (trigger.trigger) {
    case 'inbound_message':
      return `New customer message(s). See ${convoFolder}/messages.md for context.`
    case 'approval_resumed':
      return trigger.decision === 'approved'
        ? 'Your previous action was approved. Continue.'
        : `Your previous action was rejected: ${trigger.note ?? '(no note)'}. Choose a different approach.`
    case 'supervisor':
      return `Staff added an internal note. Read ${convoFolder}/internal-notes.md for context.`
    case 'scheduled_followup':
      return `Scheduled follow-up: ${trigger.reason}.`
    case 'manual':
      return `Manual wake: ${trigger.reason}.`
    case 'operator_thread':
    case 'heartbeat':
      // Operator wakes never flow through the concierge renderer — they have
      // their own renderer in `build-config/operator.ts`. If we ever see one
      // here, it indicates a wiring bug in the dispatch path.
      return `Concierge wake misrouted: ${trigger.trigger}.`
    default: {
      const exhaustive: never = trigger
      return `Unknown trigger: ${String(exhaustive)}`
    }
  }
}
