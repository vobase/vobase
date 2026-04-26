import { type DispatchOrphan, resolveDispatchOrphans, scanDispatchOrphans } from './dispatch'
import type { JournalEventLike } from './journal'
import type { CustomSideLoadMaterializer } from './side-load-collector'
import type { AgentTool } from './types'

export type GetLastWakeTail = (conversationId: string) => Promise<{ interrupted: boolean }>

/** Fetches events for a single wake — used by the orphan scanner. */
export type GetWakeEvents = (wakeId: string) => Promise<ReadonlyArray<JournalEventLike & Record<string, unknown>>>

const INTERRUPTED_BLOCK =
  '<previous-turn-interrupted>The previous agent turn was interrupted mid-execution (process restart or crash). ' +
  'Review the workspace state and resume or retry the interrupted action as appropriate. ' +
  'Do not repeat work that already completed.</previous-turn-interrupted>'

export function createRestartRecoveryContributor(
  conversationId: string,
  getLastWakeTail: GetLastWakeTail,
): CustomSideLoadMaterializer {
  let fired = false

  return {
    kind: 'custom',
    priority: 100,
    contribute: async () => {
      if (fired) return ''
      fired = true
      const tail = await getLastWakeTail(conversationId)
      return tail.interrupted ? INTERRUPTED_BLOCK : ''
    },
  }
}

export interface RecoverDispatchesInput {
  organizationId: string
  conversationId: string
  wakeId: string
  getWakeEvents: GetWakeEvents
  tools: ReadonlyArray<Pick<AgentTool, 'name' | 'idempotent'>>
  now?: () => Date
}

export interface RecoverDispatchesResult {
  orphans: DispatchOrphan[]
  replayable: DispatchOrphan[]
  lost: DispatchOrphan[]
}

/**
 * Restart-recovery driver: scan the wake's journal for `tool_dispatch_started`
 * events without a matching completion, then classify each orphan as
 * replayable (idempotent tool) or lost (journals `tool_dispatch_lost`).
 *
 * The wake-handler invokes this once before the first turn of a resumed wake
 * and uses `replayable` to re-dispatch surviving operations; `lost` triggers
 * a wake abort.
 */
export async function recoverOrphanedDispatches(input: RecoverDispatchesInput): Promise<RecoverDispatchesResult> {
  const events = await input.getWakeEvents(input.wakeId)
  const orphans = scanDispatchOrphans({ events })
  if (orphans.length === 0) return { orphans, replayable: [], lost: [] }
  const { replayable, lost } = await resolveDispatchOrphans({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    wakeId: input.wakeId,
    orphans,
    tools: input.tools,
    now: input.now,
  })
  return { orphans, replayable, lost }
}
