import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

/**
 * Track escalated (pending + human-handled) conversation count.
 * Plays an audio alert when the count increases.
 * Relies on useRealtimeInvalidation() to auto-invalidate the query key.
 */
export function useEscalationNotifications() {
  const queryClient = useQueryClient();
  // -1 sentinel: skip alert on initial page load
  const prevCountRef = useRef(-1);

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['messaging-conversations', 'pending-count'],
    queryFn: async () => {
      const res = await fetch(
        '/api/messaging/conversations?status=pending&handler=human',
      );
      if (!res.ok) return 0;
      const conversations: unknown[] = await res.json();
      return conversations.length;
    },
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (prevCountRef.current === -1) {
      // First fetch — store baseline, no alert
      prevCountRef.current = unreadCount;
      return;
    }
    if (unreadCount > prevCountRef.current) {
      playAlert();
    }
    prevCountRef.current = unreadCount;
  }, [unreadCount]);

  const clearCount = () => {
    prevCountRef.current = 0;
    queryClient.setQueryData(['messaging-conversations', 'pending-count'], 0);
  };

  return { unreadCount, clearCount };
}

/** Play a short beep via Web Audio API. */
function playAlert() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800;
    gain.gain.value = 0.3;
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch {
    // Audio not available — silent fallback
  }
}
