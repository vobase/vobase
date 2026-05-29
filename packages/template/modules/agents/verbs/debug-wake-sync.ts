/**
 * `vobase agents debug wake-sync` — inject a simulated inbound message and
 * BLOCK until the agent's resulting wake reaches a terminal `agent_end`,
 * then return the wake summary + the tool calls it made.
 *
 * This collapses the manual interactive-testing loop (send inbound → poll
 * `messaging messages` → cross-check `messaging notes`) into a single awaited
 * call. Drive a multi-turn scenario by reusing the same `--from` across calls:
 * the inbound dedups onto the same web contact + conversation, and each call
 * carries a fresh `externalMessageId` so it always wakes the agent.
 *
 * The message is routed through the channels module's generic `dispatchInbound`
 * exactly like a real web inbound, so assignment, the 24h window, and the wake
 * enqueue behave identically — this is a faithful simulation, not a shortcut
 * path. Routing target = `--assign` override, else the web instance's
 * configured `defaultAssignee`; without either the conversation lands
 * unassigned and no agent wakes (the verb reports `status: 'no_wake'`).
 *
 * Admin-tier: it injects inbound traffic and surfaces cost/PII. Never exposed
 * to a wake's bash sandbox.
 *
 * Caveats:
 *  - One wake per call. A customer follow-up arriving mid-wake drains via the
 *    SteerQueue into the *same* wake; staff-note / approval-resumed re-wakes
 *    are separate `wake_id`s this verb won't observe.
 *  - `endReason: 'blocked'` means the wake paused on an approval (card / file /
 *    book_slot) — it ended without a customer-visible reply. Inspect the
 *    pending proposal rather than waiting for text.
 */

import { dispatchInbound } from '@modules/channels/service/inbound'
import { getInstance, listInstances } from '@modules/channels/service/instances'
import { defineCliVerb, type MessageReceivedEvent } from '@vobase/core'
import { z } from 'zod'

import { waitForWake } from '../service/debug-readers'

/** 1s negative skew tolerates app↔DB clock drift without catching a wake that ended just before the trigger. */
const WATERMARK_SKEW_MS = 1000

function rand(): string {
  return Math.random().toString(36).slice(2, 10)
}

export const debugWakeSyncVerb = defineCliVerb({
  name: 'agents debug wake-sync',
  description:
    'Inject a simulated web inbound message and block until the agent wake settles (agent_end), then return the wake summary + tool calls. Reuse --from across calls to drive a multi-turn conversation.',
  usage:
    'vobase agents debug wake-sync --text="..." [--from=<stable-key>] [--channelInstanceId=<id>] [--assign=agent:<id>] [--timeout=120]',
  audience: 'admin',
  input: z.object({
    text: z.string().min(1),
    /** Stable web external key. Omit ⇒ fresh random key ⇒ new conversation. Reuse ⇒ continue the same conversation. */
    from: z.string().min(1).optional(),
    profile: z.string().min(1).default('CLI WakeSync'),
    /** Web channel instance to inject through. Omit ⇒ the org's sole web instance (errors if 0 or >1). */
    channelInstanceId: z.string().min(1).optional(),
    /** Assignee override in `agent:<id>` form. Omit ⇒ the instance's configured defaultAssignee. */
    assign: z.string().min(1).optional(),
    /** Wall-clock budget in seconds before giving up (status: 'timeout'). */
    timeout: z.number().int().positive().max(300).default(120),
    /** Poll cadence in ms. */
    pollMs: z.number().int().min(250).max(10_000).default(1500),
  }),
  body: async ({ input, ctx }) => {
    // Resolve the web channel instance to inject through.
    let instance: Awaited<ReturnType<typeof getInstance>>
    if (input.channelInstanceId) {
      instance = await getInstance(input.channelInstanceId)
      if (!instance || instance.organizationId !== ctx.organizationId) {
        return { ok: false as const, error: 'channel instance not in this organization', errorCode: 'not_found' }
      }
    } else {
      const webs = await listInstances(ctx.organizationId, 'web')
      if (webs.length === 0) {
        return { ok: false as const, error: 'no web channel instance in this organization', errorCode: 'not_found' }
      }
      if (webs.length > 1) {
        return {
          ok: false as const,
          error: `multiple web channel instances (${webs.map((w) => w.id).join(', ')}) — pass --channelInstanceId`,
          errorCode: 'ambiguous',
        }
      }
      instance = webs[0]
    }

    const cfg = (instance.config ?? {}) as { defaultAssignee?: unknown }
    const defaultAssignee = input.assign ?? (typeof cfg.defaultAssignee === 'string' ? cfg.defaultAssignee : null)
    if (!defaultAssignee) {
      return {
        ok: false as const,
        error:
          'no assignee — instance has no defaultAssignee and --assign was not given; the wake would not route to an agent',
        errorCode: 'no_assignee',
      }
    }

    const from = input.from ?? `cli-wake-sync-${Date.now()}-${rand()}`
    const event: MessageReceivedEvent = {
      type: 'message_received',
      channel: instance.channel,
      from,
      profileName: input.profile,
      messageId: `cli-${Date.now()}-${rand()}`,
      content: input.text,
      messageType: 'text',
      timestamp: Date.now(),
    }

    // Watermark BEFORE the trigger so waitForWake locks onto this wake, not a stale one.
    const since = new Date(Date.now() - WATERMARK_SKEW_MS)

    let conversationId: string
    try {
      const [res] = await dispatchInbound([event], instance, { defaultAssignee })
      if (!res) {
        return {
          ok: false as const,
          error: 'inbound produced no conversation (instance released?)',
          errorCode: 'dispatch_failed',
        }
      }
      conversationId = res.conversationId
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        errorCode: 'dispatch_failed',
      }
    }

    const wake = await waitForWake({
      organizationId: ctx.organizationId,
      conversationId,
      since,
      timeoutMs: input.timeout * 1000,
      pollMs: input.pollMs,
    })

    return {
      ok: true as const,
      data: { conversationId, from, channelInstanceId: instance.id, ...wake },
      summary: `${wake.status} — conv ${conversationId} wake ${wake.wakeId ?? '(none)'} reason=${wake.endReason ?? '—'} tools=${wake.toolCalls} cost=$${wake.costUsd.toFixed(4)} (${(wake.waitedMs / 1000).toFixed(1)}s)`,
    }
  },
  formatHint: 'json',
})
