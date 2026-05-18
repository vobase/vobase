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
        // Skip the `messages` refetch while the user's own staff-reply
        // mutation is pending for this conversation. The SSE-driven refetch
        // would otherwise overwrite the optimistic bubble with the real row
        // mid-flight: the new `Message.id` re-keys that `<MessageRow>` so
        // React unmounts the optimistic node, the AI-elements `Conversation`
        // (`use-stick-to-bottom`) sees the resize, and the bubble visibly
        // bounces with a one-frame gap. Defer to the mutation's own
        // `onSettled` invalidate for the final reconcile.
        const staffReplyPending = queryClient.isMutating({ mutationKey: ['staff-reply', payload.id] }) > 0
        if (!staffReplyPending) {
          queryClient.invalidateQueries({ queryKey: ['messages', payload.id] })
        }
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

    // Agent definition mutations — the principal directory aggregates these
    // into every conversation header, assignee filter, and mention popover.
    // useAgentDefinitions reads ['agents', 'definitions']; invalidating the
    // ['agents'] prefix also covers the per-agent detail queries.
    if (payload.table === 'agent_definitions') {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      return
    }

    // Pending-invitation mutations (mint via better-auth, resend/revoke via
    // /api/team/invitations). Keep the list fresh in the team roster page.
    if (payload.table === 'auth_invitation') {
      queryClient.invalidateQueries({ queryKey: ['auth_invitation'] })
      return
    }

    // Staff profile mutations — same directory fan-out as agent_definitions.
    // useStaffList reads ['staff', 'list']; the ['staff'] prefix covers it
    // plus detail queries. Memory/profile column writes also surface in the
    // drive overlay (/staff/<id>/MEMORY.md, /staff/<id>/PROFILE.md), so fan
    // those actions out to ['drive'] as well.
    if (payload.table === 'staff_profiles') {
      queryClient.invalidateQueries({ queryKey: ['staff'] })
      if (payload.action === 'memory_updated' || payload.action === 'profile_updated') {
        queryClient.invalidateQueries({ queryKey: ['drive'] })
      }
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

    // /automations dashboard. Each table fans out to the matching
    // widget's TanStack Query key. Banner stats also reflect rule + cap
    // changes, so we hit it on every dispatch event.
    if (payload.table === 'automations' || payload.table === 'tenant_budget_caps') {
      queryClient.invalidateQueries({ queryKey: ['system', 'activity', 'automations'] })
      queryClient.invalidateQueries({ queryKey: ['system', 'activity', 'banner'] })
      return
    }
    if (payload.table === 'automation_runs') {
      queryClient.invalidateQueries({ queryKey: ['system', 'activity', 'runs'] })
      queryClient.invalidateQueries({ queryKey: ['system', 'activity', 'banner'] })
      return
    }
    if (payload.table === 'active_wakes') {
      queryClient.invalidateQueries({ queryKey: ['system', 'activity', 'active-wakes'] })
      queryClient.invalidateQueries({ queryKey: ['system', 'activity', 'banner'] })
      return
    }

    // Broad fallback
    queryClient.invalidateQueries({ queryKey: [payload.table] })
  })
}
