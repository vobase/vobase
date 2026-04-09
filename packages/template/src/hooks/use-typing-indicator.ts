import { useCallback, useEffect, useRef } from 'react';

import {
  type RealtimePayload,
  subscribeToPayloads,
} from '@/hooks/use-realtime';
import { aiClient } from '@/lib/api-client';
import { useStaffChatStore } from '@/stores/staff-chat-store';

/**
 * Hook for the SSE listener side — detects typing events from the shared realtime stream.
 * Subscribes to raw payloads via subscribeToPayloads (no duplicate SSE connection).
 * Listens for events where table === 'interactions-typing' and id === interactionId.
 * Auto-clears expired entries via setInterval.
 */
export function useTypingListener(interactionId: string): void {
  const addTypingUser = useStaffChatStore((s) => s.addTypingUser);
  const removeTypingUser = useStaffChatStore((s) => s.removeTypingUser);

  useEffect(() => {
    const unsubscribe = subscribeToPayloads((payload: RealtimePayload) => {
      if (
        payload.table === 'interactions-typing' &&
        payload.id === interactionId &&
        payload.action
      ) {
        const colonIdx = payload.action.indexOf(':');
        if (colonIdx > 0) {
          const userId = payload.action.slice(0, colonIdx);
          const userName = payload.action.slice(colonIdx + 1);
          addTypingUser(interactionId, userId, userName);
        }
      }
    });

    // Auto-clear expired typing indicators every second
    const cleanupInterval = setInterval(() => {
      const store = useStaffChatStore.getState();
      const convMap = store.typingUsers.get(interactionId);
      if (!convMap) return;
      const now = Date.now();
      for (const [userId, user] of convMap) {
        if (user.expiresAt <= now) {
          removeTypingUser(interactionId, userId);
        }
      }
    }, 1000);

    return () => {
      unsubscribe();
      clearInterval(cleanupInterval);
    };
  }, [interactionId, addTypingUser, removeTypingUser]);
}

/**
 * Hook for the sender side — throttled typing signal.
 * POST /api/ai/interactions/:id/typing, throttled to 1.5s intervals.
 */
export function useTypingSender(interactionId: string): {
  signalTyping: () => void;
} {
  const lastSentRef = useRef(0);

  const signalTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastSentRef.current < 1500) return;
    lastSentRef.current = now;

    aiClient.interactions[':id'].typing
      .$post({ param: { id: interactionId } })
      .catch(() => {});
  }, [interactionId]);

  return { signalTyping };
}
