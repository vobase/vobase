/**
 * Conversation-lane wake-config assembly: the `inbound_message` / `supervisor` /
 * `approval_resumed` path that the helpdesk has had since day one. Every
 * conversation-lane wake is conversation-bound — `conv.channelInstanceId` drives the
 * `/contacts/<contactId>/<channelInstanceId>/` materializers, the side-load
 * pulls the rolling transcript, and the trigger renderer points at messages.md
 * for context.
 *
 * Standalone-lane wakes (heartbeat, operator-thread) use `./standalone.ts` instead;
 * shared building blocks live in `./base.ts`.
 */

import { buildAuthLookup } from '@auth/lookup'
import * as agentsModule from '@modules/agents/agent'
import type { WakeTrigger } from '@modules/agents/events'
import type { AgentDefinition } from '@modules/agents/schema'
import { buildDefaultReadOnlyConfig, conversationVerbs, driveVerbs, teamVerbs } from '@modules/agents/workspace'
import { createWorkspace } from '@modules/agents/workspace/create-workspace'
import * as contactsModule from '@modules/contacts/agent'
import { get as getContact, readMemory as readContactMemory } from '@modules/contacts/service/contacts'
import * as driveModule from '@modules/drive/agent'
import { filesServiceFor } from '@modules/drive/service/files'
import * as messagingModule from '@modules/messaging/agent'
import type { Conversation } from '@modules/messaging/schema'
import { list as listMessages } from '@modules/messaging/service/messages'
import { listNotes as listInternalNotes } from '@modules/messaging/service/notes'
import * as teamModule from '@modules/team/agent'
import type { AgentContributions, WakeRuntime, WorkspaceMaterializer } from '@vobase/core'
import {
  conversationEvents,
  createIdleResumptionContributor,
  DirtyTracker,
  journalGetLastWakeTail,
  type OnEventListener,
} from '@vobase/core'
import { desc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'

import { resolveCapability } from '../capability'
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
  composeHooks,
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
  /**
   * Optional explicit trigger to use in place of the default
   * `inbound_message` shape. Supervisor wakes pass a `supervisor` trigger
   * here so the renderer + `systemHash` reflect the staff-note variant.
   * The override is forwarded unchanged into `trigger`, `triggerKind`, and
   * `renderTrigger` — never re-derived downstream.
   */
  triggerOverride?: WakeTrigger
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

  const contactsReader = { get: getContact, readMemory: readContactMemory }
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

  const trigger: WakeTrigger = input.triggerOverride ?? {
    trigger: 'inbound_message',
    conversationId,
    messageIds: [data.messageId],
  }
  const capability = resolveCapability(trigger.trigger)

  // Peer-wake guard (staff-assigned conv): when an agent is @-mentioned in an
  // internal note on a conversation assigned to a STAFF user, the staff person
  // owns the customer-facing reply. Strip tools that touch the customer so the
  // mentioned agent can only read context + update memory. Doesn't apply when
  // the assignee is a different agent — in that case the prompt directive is
  // sufficient (peer agents may collaborate via internal notes).
  const CUSTOMER_FACING_TOOLS = new Set(['reply', 'send_card', 'send_file', 'book_slot'])
  const isPeerWakeOnStaffAssignedConv =
    trigger.trigger === 'supervisor' &&
    'mentionedAgentId' in trigger &&
    trigger.mentionedAgentId === agentId &&
    conv.assignee.startsWith('user:')

  const sseListener = buildSseListener({
    logPrefix: capability.logPrefix,
    realtime: deps.realtime,
    conversationId: data.conversationId,
  })

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
      t
        ? capability.render(t, {
            contactId: data.contactId,
            channelInstanceId,
            assignee: conv.assignee,
            currentAgentId: agentId,
          })
        : 'Manual wake.',

    workspace: { bash: workspace.bash, innerFs: workspace.innerFs },
    runtime: { fs: workspace.innerFs, tracker: dirtyTracker } satisfies WakeRuntime,

    ...composeHooks({
      capability,
      contributions,
      coreListeners: [
        sseListener,
        workspaceSyncListener as OnEventListener<WakeTrigger>,
        memoryDistillListener as OnEventListener<WakeTrigger>,
      ],
      toolFilter: isPeerWakeOnStaffAssignedConv ? (t) => !CUSTOMER_FACING_TOOLS.has(t.name) : undefined,
    }),
    materializers: wakeMaterializers,
    sideLoadContributors: contributions.sideLoad,
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
