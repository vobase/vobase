/**
 * Conversation-lane wake-config assembly: the `inbound_message` / `staff_note` /
 * `approval_resumed` path that the helpdesk has had since day one. Every
 * conversation-lane wake is conversation-bound — `conv.channelInstanceId` drives the
 * `/contacts/<contactId>/<channelInstanceId>/` materializers, the side-load
 * pulls the rolling transcript, and the trigger renderer points at MESSAGES.md
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
  capStaffIdsForBudgetHeader,
  composeHooks,
  IDLE_RESUMPTION_THRESHOLD_MS,
  resolveStaffIdsForOrg,
} from './build-base'
import type { WakeContext } from './context'
import type { WakeTrigger } from './events'
import { createModel, resolveApiKey } from './llm'
import { setupMessageHistory } from './message-history'
import { createWorkspaceSyncListener } from './observers/workspace-sync'
import { enqueueSelfReflection } from './self-reflection'

export type { SelfReflectionCtx } from './self-reflection'

import { resolvePlatformHint } from './platform-hints'
import { buildFrozenPrompt } from './prompt'
import { resolveSessionContext } from './session-context'
import { resolveTriggerSpec } from './trigger'
import { renderUnreadActivity, snapshotUnreadActivity } from './unread-activity'
import { buildDefaultReadOnlyConfig, createWorkspace } from './workspace'

export interface ConversationWakeConfigInput {
  data: {
    organizationId: string
    conversationId: string
    /**
     * Optional. Carried for back-compat with the inbound-message default
     * trigger fallback below; non-inbound triggers (`staff_note`,
     * `caption_ready`, …) leave this unset and pass their own
     * `triggerOverride` instead.
     */
    messageId?: string
    contactId: string
  }
  conv: Conversation
  agentId: string
  agentDefinition: AgentDefinition
  contributions: AgentContributions<WakeContext>
  deps: BaseWakeDeps
  /**
   * Optional explicit trigger to use in place of the default
   * `inbound_message` shape. Staff-note wakes pass a `staff_note` trigger
   * here so the renderer + `systemHash` reflect the staff-note variant;
   * `caption_ready` wakes (drive OCR completion) likewise pass their own
   * variant. The override is forwarded unchanged into `trigger`,
   * `triggerKind`, and `renderTrigger` — never re-derived downstream.
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
  const budgetHeaderStaffIds = capStaffIdsForBudgetHeader(staffIds, deps.logger)
  const authLookup = buildAuthLookup(deps.db)

  const roConfig = buildDefaultReadOnlyConfig({
    agentId,
    contactId: data.contactId,
    channelInstanceId,
    staffIds,
    roHints: contributions.roHints,
  })

  // Tool guidance section in AGENTS.md reflects the conversation-lane catalogue
  // — same set the wake's harness will see (staff-note's `audience`
  // filter is a runtime exception not surfaced here). Tools opt into the lane
  // via their `lane` field; `'both'` enrols a tool into both lanes (e.g. add_note).
  const laneTools = contributions.tools.filter((t) => t.lane === 'conversation' || t.lane === 'both')

  const trigger: WakeTrigger =
    input.triggerOverride ??
    (data.messageId
      ? { trigger: 'inbound_message', conversationId, messageIds: [data.messageId] }
      : (() => {
          throw new Error('conversationWakeConfig: triggerOverride or data.messageId is required')
        })())
  const capability = resolveTriggerSpec(trigger.trigger)

  // Audience tier — only inbound-message wakes are customer-driven and untrusted;
  // every other conversation-lane trigger (staff_note, approval, scheduled,
  // manual) is staff-initiated.
  const audienceTier: 'staff' | 'contact' = trigger.trigger === 'inbound_message' ? 'contact' : 'staff'

  const wakeCtx: WakeContext = {
    organizationId: data.organizationId,
    agentId,
    contactId: data.contactId,
    channelInstanceId,
    conversationId,
    drive,
    staffIds,
    budgetHeaderStaffIds,
    authLookup,
    agentDefinition,
    tools: laneTools,
    agentsMdContributors: contributions.agentsMd,
    lane: 'conversation',
    triggerKind: trigger.trigger,
    audienceTier,
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
    audienceTier,
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

  // Self-reflection signal: on agent_end enqueue a triage job so the learning
  // pipeline can decide whether anything in this wake is worth capturing.
  const selfReflectionListener: OnEventListener<WakeTrigger> = async (event) => {
    if (event.type !== 'agent_end') return
    await enqueueSelfReflection(
      { jobs: deps.jobs, organizationId: data.organizationId, agentId, conversationId },
      event,
    )
  }

  const history = await setupMessageHistory({ db: deps.db, agentId, conversationId })

  const sseListener = buildSseListener({
    logPrefix: capability.logPrefix,
    realtime: deps.realtime,
    conversationId: data.conversationId,
  })

  // Snapshot what's new since the agent's last reply — customer/staff messages
  // and internal notes from non-self authors. Prepended to every turn's wake
  // cue so the producer-side debounce never hides the burst from the LLM.
  // Frozen at wake boot to preserve the frozen-snapshot invariant.
  const unreadActivity = await snapshotUnreadActivity({ db: deps.db, conversationId, agentId })
  const unreadPreamble = renderUnreadActivity(unreadActivity, `/contacts/${data.contactId}/${channelInstanceId}`)

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
    renderTrigger: (t: WakeTrigger | undefined) => {
      const cue = t
        ? capability.render(t, {
            contactId: data.contactId,
            channelInstanceId,
            assignee: conv.assignee,
            currentAgentId: agentId,
          })
        : 'Manual wake.'
      return unreadPreamble ? `${unreadPreamble}\n\n${cue}` : cue
    },

    workspace: { bash: workspace.bash, innerFs: workspace.innerFs },
    runtime: { fs: workspace.innerFs, tracker: dirtyTracker } satisfies WakeRuntime,

    ...composeHooks({
      capability,
      laneTools,
      contributions,
      coreListeners: [sseListener, workspaceSyncListener as OnEventListener<WakeTrigger>, selfReflectionListener],
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

    maxTurns: 10,
    logger: deps.logger,
  }
}
