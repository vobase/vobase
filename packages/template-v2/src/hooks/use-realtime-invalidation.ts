import { useQueryClient } from '@tanstack/react-query'

import { useSse } from './use-sse'

export interface RealtimePayload {
  table: string
  id?: string
  action?: string
}

/**
 * Subscribes to `/api/sse` and invalidates TanStack Query keys when the
 * server pushes a pg NOTIFY payload. Mirrors the original template hook
 * but simplified for Phase 2 (single `vobase_sse` channel).
 */
export function useRealtimeInvalidation(): void {
  const queryClient = useQueryClient()

  useSse((evt) => {
    if (evt.event !== 'invalidate' || !evt.data) return

    let payload: RealtimePayload
    try {
      payload = JSON.parse(evt.data) as RealtimePayload
    } catch {
      return
    }

    if (!payload.table) return

    // Targeted invalidation: messaging conversations list + specific conversation
    if (payload.table === 'conversations') {
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      // Mentions piggy-back on conversation updates — agent-authored notes fire
      // the same `conversations` NOTIFY on tool_execution_end, and there's no
      // dedicated `internal_notes` channel.
      queryClient.invalidateQueries({ queryKey: ['team', 'mentions'] })
      if (payload.id) {
        queryClient.invalidateQueries({ queryKey: ['conversation', payload.id] })
        queryClient.invalidateQueries({ queryKey: ['messages', payload.id] })
        queryClient.invalidateQueries({ queryKey: ['notes', payload.id] })
        queryClient.invalidateQueries({ queryKey: ['activity', payload.id] })
      }
      return
    }

    // Agent session events: invalidate the affected conversation's messages
    if (payload.table === 'agent-sessions' && payload.id) {
      if (payload.action === 'message_update') return
      queryClient.invalidateQueries({ queryKey: ['messages', payload.id] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      return
    }

    // Approval decisions
    if (payload.table === 'approvals') {
      queryClient.invalidateQueries({ queryKey: ['approvals'] })
      return
    }

    // Learning proposal lifecycle (learning_proposed / learning_approved / learning_rejected)
    if (payload.table === 'learning_proposals') {
      queryClient.invalidateQueries({ queryKey: ['learnings'] })
      return
    }

    // Change-proposal lifecycle (created / auto_written / approved / rejected)
    if (payload.table === 'change_proposals') {
      queryClient.invalidateQueries({ queryKey: ['change_proposals'] })
      return
    }

    // Drive file mutations — broad invalidate; the 'drive' key covers both
    // tree listings and file reads under our DriveProvider.
    if (payload.table === 'drive_files' || payload.table === 'drive.files') {
      queryClient.invalidateQueries({ queryKey: ['drive'] })
      return
    }

    // Broad fallback
    queryClient.invalidateQueries({ queryKey: [payload.table] })
  })
}
