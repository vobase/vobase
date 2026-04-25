/**
 * Per-wake `createHarness({...})` parameter assembly.
 *
 * Composes the static contributions (collected at boot) with per-wake state
 * (workspace, dirty tracker, listeners, materializers, side-load) into the
 * single typed config object the harness consumes. Stays pure: no IO past
 * the read-only setup helpers it calls (session-context, message-history,
 * workspace creation, frozen-prompt building).
 *
 * Frozen-snapshot invariant: every input that lands in `systemPrompt` is
 * computed once here. Mid-wake writes (memory, drive proposals, file ops)
 * persist immediately but only surface in the NEXT turn's side-load — the
 * provider's prefix cache is byte-keyed on the prompt.
 */

import { buildAuthLookup } from '@auth/lookup'
import * as agentsModule from '@modules/agents/agent'
import type { AgentEvent, WakeTrigger } from '@modules/agents/events'
import type { AgentDefinition } from '@modules/agents/schema'
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
import { conversationSideLoad } from '@modules/messaging/side-load'
import * as teamModule from '@modules/team/agent'
import { staff as teamStaff } from '@modules/team/service'
import type { AgentContributions, AgentTool, HarnessLogger, WakeRuntime, WorkspaceMaterializer } from '@vobase/core'
import {
  conversationEvents,
  createIdleResumptionContributor,
  DirtyTracker,
  journalAppend,
  journalGetLastWakeTail,
  type OnEventListener,
} from '@vobase/core'
import { desc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'

import type { RealtimeService, ScopedDb } from '~/runtime'
import { buildFrozenPrompt } from './frozen-prompt-builder'
import type { LlmEmitter } from './llm-call'
import { createModel, resolveApiKey } from './llm-provider'
import { setupMessageHistory } from './message-history'
import { resolvePlatformHint } from './platform-hints'
import { resolveSessionContext } from './session-context'

/**
 * Idle-resumption threshold: if the conversation has been quiet longer than
 * this, the side-load injects a `<conversation-idle-resume>` marker so the
 * agent acknowledges the gap instead of assuming conversational recency.
 * 24h matches typical helpdesk "stale thread" semantics.
 */
const IDLE_RESUMPTION_THRESHOLD_MS = 24 * 60 * 60 * 1000

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
  deps: { db: ScopedDb; realtime: RealtimeService; logger: HarnessLogger }
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

  const sseListener: OnEventListener<WakeTrigger> = (event) => {
    const anyEv = event as unknown as Record<string, unknown>
    const detail = anyEv.toolName ? ` tool=${anyEv.toolName}` : ''
    const reason = anyEv.reason ? ` reason=${anyEv.reason}` : ''
    const text = anyEv.textDelta ? ` text=${String(anyEv.textDelta).slice(0, 80)}` : ''
    const args = anyEv.args ? ` args=${JSON.stringify(anyEv.args).slice(0, 200)}` : ''
    const result = anyEv.result ? ` result=${JSON.stringify(anyEv.result).slice(0, 200)}` : ''
    const isError = anyEv.isError ? ' ERROR' : ''
    console.log(`[wake] ${event.type} turn=${event.turnIndex}${detail}${reason}${text}${args}${isError}${result}`)
    if (event.type === 'tool_execution_end') {
      deps.realtime.notify({ table: 'messages', id: data.conversationId, action: 'INSERT' })
      deps.realtime.notify({ table: 'conversations', id: data.conversationId, action: 'UPDATE' })
    }
  }

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

    tools: contributions.tools as readonly AgentTool[],
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
    sideLoadContributors: [conversationSideLoad, ...contributions.sideLoad],
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

    emitEventHandle,

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
    default: {
      const exhaustive: never = trigger
      return `Unknown trigger: ${String(exhaustive)}`
    }
  }
}

/**
 * Return the set of staff userIds materialized under `/staff/<id>/` for this
 * wake — every staff_profiles row in the org. Silent-fails to `[]` when the
 * team service isn't available yet (boot ordering for headless tests).
 */
async function resolveStaffIdsForOrg(organizationId: string): Promise<readonly string[]> {
  try {
    const profiles = await teamStaff.list(organizationId)
    return profiles.map((p) => p.userId)
  } catch {
    return []
  }
}
