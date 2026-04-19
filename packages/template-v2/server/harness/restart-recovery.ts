import type { CustomSideLoadMaterializer } from './side-load-collector'

export type GetLastWakeTail = (conversationId: string) => Promise<{ interrupted: boolean }>

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
