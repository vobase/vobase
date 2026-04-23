/**
 * Browser notifications for new @-mentions.
 *
 * Mounted once in the app shell. Requests permission the first time the user
 * has any unread mention. Tracks the set of seen noteIds across renders; when
 * `useUnreadMentions()` delivers a noteId we haven't seen, fires one
 * `Notification` (clicking it focuses the window and navigates to the
 * conversation). Notifications auto-close via the browser's default policy.
 *
 * Safe in non-browser contexts (SSR / tests): bails out if `window` or
 * `Notification` is missing.
 */

import { useUnreadMentions } from '@modules/team/api/use-unread-mentions'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'

function hasNotificationApi(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

function truncate(s: string, max = 140): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

export function useMentionBrowserNotifications(): void {
  const { data: mentions = [] } = useUnreadMentions()
  const navigate = useNavigate()
  const seenIdsRef = useRef<Set<string> | null>(null)
  const primedRef = useRef(false)

  useEffect(() => {
    if (!hasNotificationApi()) return

    // First render: seed the seen set with everything currently unread. We
    // don't fire notifications for pre-existing mentions — only deltas.
    if (seenIdsRef.current === null) {
      seenIdsRef.current = new Set(mentions.map((m) => m.noteId))
      primedRef.current = true
      // If there are unread mentions on mount and permission hasn't been
      // asked, prompt now — that's the most honest moment to ask.
      if (mentions.length > 0 && Notification.permission === 'default') {
        void Notification.requestPermission().catch(() => {
          /* user dismissed the prompt */
        })
      }
      return
    }

    const seen = seenIdsRef.current
    const fresh = mentions.filter((m) => !seen.has(m.noteId))
    if (fresh.length === 0) return

    // Ensure every fresh noteId is tracked even when we can't actually
    // notify (permission denied, tab hidden, etc.) so we don't re-fire.
    for (const m of fresh) seen.add(m.noteId)

    if (Notification.permission !== 'granted') {
      // Opportunistically ask on the first delta if the user never decided.
      if (Notification.permission === 'default') {
        void Notification.requestPermission().catch(() => undefined)
      }
      return
    }

    for (const m of fresh) {
      try {
        const n = new Notification('New mention', {
          body: truncate(m.body),
          icon: '/favicon-32x32.png',
          tag: `vobase-mention-${m.noteId}`,
        })
        n.onclick = () => {
          window.focus()
          navigate({ to: '/messaging', search: { conv: m.conversationId } }).catch(() => undefined)
          n.close()
        }
      } catch {
        // Notification constructors can throw in some browsers if the page is
        // not in a secure context — tracking the noteId as seen is enough.
      }
    }
  }, [mentions, navigate])
}
