import { useQueryClient } from '@tanstack/react-query'

import { useSse } from './use-sse'

export interface RealtimePayload {
  table: string
  id?: string
  action?: string
  /** Present on `change_proposals` events so the hook can fan out to the affected target's query keys. */
  resourceModule?: string
  resourceType?: string
  resourceId?: string
  conversationId?: string | null
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

    // Change-proposal lifecycle (created / auto_written / approved / rejected).
    // Fan out to the affected downstream cache so the page that owns the
    // mutated resource (Drive tree, contact card, agent skills, agent memory)
    // refreshes without a manual reload.
    if (payload.table === 'change_proposals') {
      queryClient.invalidateQueries({ queryKey: ['change_proposals'] })
      const decided = payload.action === 'approved' || payload.action === 'auto_written'
      if (decided) {
        if (payload.resourceModule === 'drive') {
          queryClient.invalidateQueries({ queryKey: ['drive'] })
        } else if (payload.resourceModule === 'contacts') {
          queryClient.invalidateQueries({ queryKey: ['contacts'] })
          if (payload.resourceId) {
            queryClient.invalidateQueries({ queryKey: ['contact', payload.resourceId] })
            queryClient.invalidateQueries({ queryKey: ['drive'] })
          }
        } else if (payload.resourceModule === 'agents') {
          queryClient.invalidateQueries({ queryKey: ['agents'] })
          if (payload.resourceId) {
            queryClient.invalidateQueries({ queryKey: ['agent', payload.resourceId] })
            queryClient.invalidateQueries({ queryKey: ['drive'] })
          }
        }
      }
      if (payload.conversationId) {
        queryClient.invalidateQueries({ queryKey: ['activity', payload.conversationId] })
      }
      return
    }

    // Staff memory mutations — drive overlay for team/staff scope reflects these rows.
    if (payload.table === 'agent_staff_memory') {
      queryClient.invalidateQueries({ queryKey: ['drive'] })
      return
    }

    // Learned-skill direct writes (defensive; the change_proposals fan-out above
    // covers the approval flow, but any future direct-write path also lands here).
    if (payload.table === 'learned_skills') {
      queryClient.invalidateQueries({ queryKey: ['drive'] })
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
