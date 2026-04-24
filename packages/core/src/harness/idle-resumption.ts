import type { CustomSideLoadMaterializer } from './side-load-collector'

/**
 * Resolves the timestamp of the last activity on a conversation.
 *
 * Implementations typically `MAX(conversation_events.created_at)` for the
 * conversation id. Returning `null` means "no prior activity" (new
 * conversation) — the contributor emits nothing.
 */
export type GetLastActivityTime = (conversationId: string) => Promise<Date | null>

export interface CreateIdleResumptionOpts {
  conversationId: string
  getLastActivityTime: GetLastActivityTime
  /** Gap threshold in milliseconds. Contributor fires only when idle exceeds this. */
  thresholdMs: number
  /** Test seam; defaults to `() => new Date()`. */
  now?: () => Date
}

/**
 * Fires once per wake, on turn 0, when the gap between the last conversation
 * activity and wake start exceeds `thresholdMs`. Injects a short marker so the
 * agent can acknowledge the gap ("it's been N days since we last spoke")
 * rather than assuming recency — a common hermes-style UX cue for long-idle
 * helpdesk conversations.
 *
 * Fires at priority 90 so it renders just below the restart-recovery block
 * (priority 100) and above baseline contributors.
 */
export function createIdleResumptionContributor(opts: CreateIdleResumptionOpts): CustomSideLoadMaterializer {
  const now = opts.now ?? (() => new Date())
  let fired = false

  return {
    kind: 'custom',
    priority: 90,
    contribute: async () => {
      if (fired) return ''
      fired = true
      const last = await opts.getLastActivityTime(opts.conversationId)
      if (!last) return ''
      const gapMs = now().getTime() - last.getTime()
      if (gapMs < opts.thresholdMs) return ''
      return `<conversation-idle-resume>${formatGap(gapMs)} since last activity — customer may have forgotten earlier context; do not assume they remember the prior turn.</conversation-idle-resume>`
    },
  }
}

function formatGap(ms: number): string {
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (ms >= day) {
    const days = Math.floor(ms / day)
    return `${days} day${days === 1 ? '' : 's'}`
  }
  if (ms >= hour) {
    const hours = Math.floor(ms / hour)
    return `${hours} hour${hours === 1 ? '' : 's'}`
  }
  const minutes = Math.max(1, Math.floor(ms / minute))
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}
