import { RequestContext } from '@mastra/core/request-context';
import type { VobaseDb } from '@vobase/core';
import { defineJob, logger } from '@vobase/core';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { getModuleDeps } from '../../messaging/lib/deps';
import {
  channelInstances,
  conversations,
  messages,
} from '../../messaging/schema';
import { scoreConversation } from '../mastra/evals/score-conversation';
import type { WakeContext } from '../mastra/workspace/commands/types';
import {
  createMastraBashTool,
  createWorkspace,
} from '../mastra/workspace/create-workspace';
import {
  formatContent,
  formatSender,
} from '../mastra/workspace/materialize-messages';
import {
  buildWakeMessage,
  type WakeTrigger,
} from '../mastra/workspace/wake-message';
import { workspaceFiles } from '../schema';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Agent wake — schedule & handle agent-wake jobs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const wakeAgentSchema = z.object({
  agentId: z.string().min(1),
  contactId: z.string().min(1),
  conversationId: z.string().min(1),
  trigger: z.enum([
    'inbound_message',
    'scheduled_followup',
    'supervisor',
    'manual',
  ]),
  payload: z.record(z.string(), z.unknown()).optional(),
});

// ─── Cancellable wake tracking ──────────────────────────────────────

interface ActiveWake {
  abort: AbortController;
  hasSideEffects: boolean;
}

/**
 * In-memory map of running wakes, keyed by conversationId.
 *
 * TODO: This is per-process — cancelWake() cannot abort wakes running on other
 * instances in a multi-instance deployment. The advisory lock and staleness
 * check still guarantee correctness, but the fast-cancel benefit is lost.
 * If scaling to multiple instances, consider a Postgres NOTIFY signal or
 * shared Redis flag to propagate cancellation cross-process.
 */
const activeWakes = new Map<string, ActiveWake>();

/**
 * Cancel a running agent wake for a conversation, if safe to do so.
 * Only cancels if the wake hasn't produced any side effects yet (no messages
 * sent, no bookings made, etc.). Returns true if the wake was cancelled.
 */
export function cancelWake(conversationId: string): boolean {
  const wake = activeWakes.get(conversationId);
  if (!wake) return false;
  if (wake.hasSideEffects) {
    logger.info('[agent-wake] Cannot cancel — wake has produced side effects', {
      conversationId,
    });
    return false;
  }
  wake.abort.abort();
  logger.info('[agent-wake] Cancelled running wake (no side effects yet)', {
    conversationId,
  });
  return true;
}

/** Iteration guard: inject wrap-up feedback at step 15+. */
export function iterationGuard({ iteration }: { iteration: number }) {
  if (iteration >= 15) {
    return {
      feedback:
        'You have used many iterations. Please wrap up your current task, send any final replies, and resolve the conversation if appropriate.',
    };
  }
}

/**
 * Fetch new messages since the last agent wake for inline injection.
 * Returns the most recent messages in chronological order.
 */
async function fetchNewMessages(
  deps: ReturnType<typeof getModuleDeps>,
  conversationId: string,
) {
  const rows = await deps.db
    .select({
      senderId: messages.senderId,
      senderType: messages.senderType,
      content: messages.content,
      contentType: messages.contentType,
      caption: messages.caption,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.private, false),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(10);

  // Reverse to chronological order (query fetches newest-first for correct truncation)
  rows.reverse();

  return rows.map((r) => ({
    time: r.createdAt.toISOString().slice(0, 16).replace('T', ' '),
    from: formatSender(r.senderType, r.senderId),
    content: formatContent(r),
  }));
}

/**
 * agents:agent-wake — Wake an agent for a conversation.
 * Cancellable: if a new inbound message arrives while the agent is still
 * reading/thinking (no side effects yet), the running wake is aborted and
 * a fresh wake starts with the updated context. Once the agent has sent a
 * reply or taken an action, the wake is no longer cancellable — the new
 * message is picked up on the next wake via the staleness check.
 *
 * Thread ID uses agent-{agentId}-conv-{conversationId} prefix, routing to
 * PostgresStore via VobaseMemoryStorage prefix rules (not the conversation thread).
 */
export const agentWakeJob = defineJob('agents:agent-wake', async (data) => {
  const { agentId, contactId, conversationId, trigger, payload } =
    wakeAgentSchema.parse(data);

  const deps = getModuleDeps();
  const { db } = deps;

  const start = Date.now();

  // Staleness check: if the last message is an agent reply (not an inbound
  // message), this wake was already handled by a previous run. Skip.
  if (trigger === 'inbound_message') {
    const [latest] = await db
      .select({
        senderType: messages.senderType,
        messageType: messages.messageType,
      })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.private, false),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(1);

    if (
      latest &&
      latest.messageType !== 'activity' &&
      latest.senderType !== 'contact'
    ) {
      logger.info('[agent-wake] Skipping stale wake — agent already replied', {
        conversationId,
        lastSenderType: latest.senderType,
      });
      return;
    }
  }

  // Concurrency guard: use a Postgres advisory lock to prevent concurrent
  // wakes for the same conversation. If another wake is already running, skip
  // — the running wake will see all messages via conversation/messages.md.
  const lockKey = conversationId
    .split('')
    .reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0, 0);
  const lockRows = (await db.execute(
    sql`SELECT pg_try_advisory_lock(${lockKey}) AS acquired`,
  )) as unknown as Array<{ acquired: boolean }>;
  if (!lockRows[0]?.acquired) {
    logger.info(
      '[agent-wake] Skipping — another wake is running for this conversation',
      { conversationId },
    );
    return;
  }

  // Register this wake as active (cancellable until first side effect)
  const abortController = new AbortController();
  const wake: ActiveWake = { abort: abortController, hasSideEffects: false };
  activeWakes.set(conversationId, wake);

  try {
    await runAgentWake({
      agentId,
      contactId,
      conversationId,
      trigger,
      payload,
      deps,
      db,
      start,
      abortSignal: abortController.signal,
      onSideEffect: () => {
        wake.hasSideEffects = true;
      },
    });
  } finally {
    activeWakes.delete(conversationId);
    await db
      .execute(sql`SELECT pg_advisory_unlock(${lockKey})`)
      .catch(() => {});
  }
});

/** Core agent wake logic, called under advisory lock. */
async function runAgentWake(params: {
  agentId: string;
  contactId: string;
  conversationId: string;
  trigger: WakeTrigger;
  payload?: Record<string, unknown>;
  deps: ReturnType<typeof getModuleDeps>;
  db: VobaseDb;
  start: number;
  abortSignal: AbortSignal;
  onSideEffect: () => void;
}) {
  const {
    agentId,
    contactId,
    conversationId,
    trigger,
    payload,
    deps,
    db,
    start,
    abortSignal,
    onSideEffect,
  } = params;

  // Resolve agent from DB
  const { agentDefinitions } = await import('../schema');
  const [agentDef] = await db
    .select()
    .from(agentDefinitions)
    .where(
      and(eq(agentDefinitions.id, agentId), eq(agentDefinitions.enabled, true)),
    );
  if (!agentDef) {
    logger.error('[agent-wake] Agent not found or disabled', { agentId });
    return;
  }

  const { resolveAgent } = await import('../mastra/agents');
  const agent = resolveAgent(agentDef);

  // Resolve channel type from conversation
  const [conversation] = await db
    .select({ channelInstanceId: conversations.channelInstanceId })
    .from(conversations)
    .where(eq(conversations.id, conversationId));

  let channelType = 'web';
  if (conversation?.channelInstanceId) {
    const [instance] = await db
      .select({ type: channelInstances.type })
      .from(channelInstances)
      .where(eq(channelInstances.id, conversation.channelInstanceId));
    if (instance?.type) channelType = instance.type;
  }

  // Build WakeContext for the workspace
  const wakeCtx: WakeContext = {
    db,
    deps,
    conversationId,
    contactId,
    agentId,
  };

  // Create workspace + fetch new messages in parallel (independent operations)
  const [workspace, newMessages] = await Promise.all([
    createWorkspace(wakeCtx, onSideEffect),
    fetchNewMessages(deps, conversationId),
  ]);
  const bashTool = createMastraBashTool(workspace.bash);

  // Build wake message
  const wakeMessage = buildWakeMessage({
    trigger,
    messages: newMessages,
    payload,
  });

  // Build RequestContext for moderation processor
  const rc = new RequestContext();
  rc.set('conversationId', conversationId);
  rc.set('contactId', contactId);
  rc.set('agentId', agentId);
  rc.set('channel', channelType);
  rc.set('deps', deps);

  try {
    const wakeStart = new Date();

    await agent.generate([{ role: 'user', content: wakeMessage }], {
      memory: {
        thread: `agent-${agentId}-conv-${conversationId}`,
        resource: `contact:${contactId}`,
      },
      maxSteps: 20,
      requestContext: rc,
      toolsets: { workspace: { bash: bashTool } },
      onIterationComplete: iterationGuard,
      maxProcessorRetries: 1,
      abortSignal,
    });

    // Post-wake: sync dirty files back to DB (concurrent upserts)
    try {
      const dirtyFiles = await workspace.getDirtyFiles();
      await Promise.all(
        dirtyFiles.map((file) =>
          db
            .insert(workspaceFiles)
            .values({
              agentId,
              contactId,
              path: file.path,
              content: file.content,
              writtenBy: 'agent',
            })
            .onConflictDoUpdate({
              target: [
                workspaceFiles.agentId,
                workspaceFiles.contactId,
                workspaceFiles.path,
              ],
              set: {
                content: file.content,
                updatedAt: new Date(),
                writtenBy: 'agent',
              },
            }),
        ),
      );
      if (dirtyFiles.length > 0) {
        logger.info('[agent-wake] Synced dirty files', {
          count: dirtyFiles.length,
          paths: dirtyFiles.map((f) => f.path),
        });
      }
    } catch (syncErr) {
      logger.warn('[agent-wake] Failed to sync dirty files', {
        conversationId,
        error: syncErr,
      });
    }

    logger.info('[agent-wake] Agent wake completed', {
      trigger,
      agentId,
      contactId,
      conversationId,
      durationMs: Date.now() - start,
    });

    // Score the conversation with real messages (fire-and-forget)
    scoreConversation({ db, conversationId, agentId, wakeStart }).catch(
      (err) => {
        logger.warn('[agent-wake] Scoring failed', {
          conversationId,
          error: err,
        });
      },
    );
  } catch (err) {
    // Aborted wakes are expected — a new message arrived and cancelled this run
    if (abortSignal.aborted) {
      logger.info('[agent-wake] Wake aborted — new message arrived', {
        trigger,
        agentId,
        conversationId,
        durationMs: Date.now() - start,
      });
      return;
    }

    logger.error('[agent-wake] Agent generation failed', {
      trigger,
      agentId,
      contactId,
      conversationId,
      error: err,
    });
  }
}
