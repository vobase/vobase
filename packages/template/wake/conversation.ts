/**
 * Conversation-lane wake-config assembly: the `inbound_message` / `supervisor` /
 * `approval_resumed` path that the helpdesk has had since day one. Every
 * conversation-lane wake is conversation-bound — `conv.channelInstanceId` drives the
 * `/contacts/<contactId>/<channelInstanceId>/` materializers, the side-load
 * pulls the rolling transcript, and the trigger renderer points at messages.md
 * for context.
 *
 * Standalone-lane wakes (heartbeat, operator-thread) use `./standalone.ts` instead;
 * shared building blocks live in `./build-base.ts`.
 */

import { buildAuthLookup } from '@auth/lookup'
import type { AgentDefinition } from '@modules/agents/schema'
import { getCliRegistry } from '@modules/agents/service/cli-registry'
import { filesServiceFor } from '@modules/drive/service/files'
import type { Conversation } from '@modules/messaging/schema'
import { classifySupervisorTrigger } from '@modules/messaging/service/notes'
import type { AgentContributions, WakeRuntime } from '@vobase/core'
import {
  conversationEvents,
  createIdleResumptionContributor,
  DirtyTracker,
  journalGetLastWakeTail,
  type OnEventListener,
} from '@vobase/core'
import { desc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'

import {
  type BaseWakeDeps,
  buildIndexFileMaterializer,
  buildJournalAdapter,
  buildSseListener,
  composeHooks,
  IDLE_RESUMPTION_THRESHOLD_MS,
  resolveStaffIdsForOrg,
} from './build-base'
import type { WakeContext } from './context'
import type { WakeTrigger } from './events'
import type { LlmEmitter } from './llm'
import { createModel, resolveApiKey } from './llm'
import { setupMessageHistory } from './message-history'
import { createMemoryDistillListener } from './observers/memory-distill'
import { createWorkspaceSyncListener } from './observers/workspace-sync'
import { resolvePlatformHint } from './platform-hints'
import { buildFrozenPrompt } from './prompt'
import { resolveSessionContext } from './session-context'
import { resolveTriggerSpec } from './trigger'
import { buildDefaultReadOnlyConfig, createWorkspace } from './workspace'

export interface ConversationWakeConfigInput {
  data: {
    organizationId: string
    conversationId: string
    messageId: string
    contactId: string
  }
  conv: Conversation
  agentId: string
  agentDefinition: AgentDefinition
  contributions: AgentContributions<WakeContext>
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

export async function conversationWakeConfig(input: ConversationWakeConfigInput): Promise<WakeConfig> {
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
    roHints: contributions.roHints,
  })

  // Tool guidance section in AGENTS.md reflects the conversation-lane catalogue
  // — same set the wake's harness will see (supervisor-coaching's `audience`
  // filter is a runtime exception not surfaced here). Tools opt into the lane
  // via their `lane` field; `'both'` enrols a tool into both lanes (e.g. add_note).
  const laneTools = contributions.tools.filter((t) => t.lane === 'conversation' || t.lane === 'both')

  const wakeCtx: WakeContext = {
    organizationId: data.organizationId,
    agentId,
    contactId: data.contactId,
    channelInstanceId,
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
    lane: 'conversation',
    organizationId: data.organizationId,
    agentId,
    contactId: data.contactId,
    conversationId,
    channelInstanceId,
    wakeId,
    agentDefinition,
    registry: getCliRegistry(),
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
  const workspaceSyncListener = createWorkspaceSyncListener({
    fs: workspace.innerFs,
    tracker: dirtyTracker,
    organizationId: data.organizationId,
    agentId,
    contactId: data.contactId,
    drive,
    logger: deps.logger,
  })

  const emitEventHandle: LlmEmitter = {}
  const memoryDistillListener = createMemoryDistillListener({
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
  const capability = resolveTriggerSpec(trigger.trigger)

  // Supervisor-wake policy is split across two seams:
  //   1. The MESSAGING module classifies the triggering note (it owns the
  //      internal-note schema). `ask_staff_answer` means staff is replying to
  //      a `vobase conv ask-staff` post the agent made; `coaching` is
  //      everything else.
  //   2. The TOOL CATALOG carries `audience` metadata on each tool. Tools
  //      marked `audience: 'customer'` produce direct customer output (reply,
  //      send_card, send_file, book_slot today).
  // The wake builder just composes those two — it never names tools by string
  // or reaches into note rows. Coaching wakes strip customer-facing tools so
  // a staff coaching note can't accidentally trigger another customer reply
  // (prompt-level guidance is unreliable; the model defies "don't reply"
  // ~30%+ of the time without the filter).
  const isSupervisorWake = trigger.trigger === 'supervisor'
  // Peer wakes (woken agent IS the @-mentioned one) are consultations, not
  // coaching of the assignee — they keep customer-facing tools so the peer
  // can craft a suggested reply. Only the assignee self-wake gets the
  // coaching filter.
  const isPeerWake = isSupervisorWake && 'mentionedAgentId' in trigger && trigger.mentionedAgentId === agentId
  let supervisorKind: 'ask_staff_answer' | 'coaching' | undefined
  if (isSupervisorWake && !isPeerWake) {
    try {
      const classification = await classifySupervisorTrigger({
        conversationId,
        triggerNoteId: trigger.noteId,
        agentId,
      })
      supervisorKind = classification.kind
    } catch (err) {
      deps.logger.warn?.({ err, conversationId, noteId: trigger.noteId }, 'supervisor-trigger classification failed')
      supervisorKind = 'coaching'
    }
  }

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
            supervisorKind,
          })
        : 'Manual wake.',

    workspace: { bash: workspace.bash, innerFs: workspace.innerFs },
    runtime: { fs: workspace.innerFs, tracker: dirtyTracker } satisfies WakeRuntime,

    ...composeHooks({
      capability,
      laneTools,
      contributions,
      coreListeners: [
        sseListener,
        workspaceSyncListener as OnEventListener<WakeTrigger>,
        memoryDistillListener as OnEventListener<WakeTrigger>,
      ],
      toolFilter: supervisorKind === 'coaching' ? (t) => t.audience !== 'customer' : undefined,
    }),
    materializers: wakeMaterializers,
    sideLoadContributors: contributions.sideLoad,

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
