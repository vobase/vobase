/**
 * Surfaces the *other side's* typing-presence on a conversation. Pass the
 * actor whose beacons you want to render — the staff inbox listens for
 * `'customer'` (so the staff member never sees their own typing echoed
 * back), and the public web chat listens for `'staff'`.
 *
 * Tracks the most recent beacon with a 3s expiry; the composer re-emits
 * every ~2s while typing so the indicator stays smooth and self-clears
 * once the actor stops.
 */

import { TYPING_ACTIONS, type TypingActor } from '@modules/messaging/lib/typing-actions'
import { useEffect, useState } from 'react'

import { useSse } from '@/hooks/use-sse'

export interface TypingPresence {
  userId: string
  name: string
  expiresAt: number
}

const TYPING_TTL_MS = 3000

export function useConversationTyping(conversationId: string | null, listenFor: TypingActor): TypingPresence | null {
  const [presence, setPresence] = useState<TypingPresence | null>(null)
  const expectedAction = TYPING_ACTIONS[listenFor]

  useSse((evt) => {
    if (evt.event !== 'invalidate' || !conversationId) return
    try {
      const payload = JSON.parse(evt.data) as {
        table?: string
        id?: string
        action?: string
        userId?: string
        userName?: string
      }
      if (payload.id !== conversationId) return
      if (
        payload.table === 'conversations' &&
        payload.action === expectedAction &&
        payload.userId &&
        payload.userName
      ) {
        setPresence({
          userId: payload.userId,
          name: payload.userName,
          expiresAt: Date.now() + TYPING_TTL_MS,
        })
        return
      }
      // Any non-typing event on this conversation (new message landed,
      // status change, etc.) means the other side just acted — dismiss the
      // indicator immediately instead of waiting on the 3s expiry.
      if (
        (payload.table === 'conversations' || payload.table === 'messages') &&
        !payload.action?.startsWith('typing.')
      ) {
        setPresence(null)
      }
    } catch {
      /* ignore malformed events */
    }
  }, Boolean(conversationId))

  useEffect(() => {
    if (!presence) return
    const remaining = presence.expiresAt - Date.now()
    if (remaining <= 0) {
      setPresence(null)
      return
    }
    const t = setTimeout(() => setPresence((cur) => (cur && cur.expiresAt <= Date.now() ? null : cur)), remaining)
    return () => clearTimeout(t)
  }, [presence])

  // Wipe stale presence when the consumer switches conversations. The `void`
  // makes `conversationId` a runtime reference so the formatter can't drop
  // it from the dependency array as "unused inside the callback body".
  useEffect(() => {
    void conversationId
    setPresence(null)
  }, [conversationId])

  return presence
}
