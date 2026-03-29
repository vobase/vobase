import { useCallback, useEffect, useRef } from 'react';

/**
 * IntersectionObserver-based read status tracking.
 * Observes message elements and debounces reporting the highest observed message ID.
 * Only active when `enabled` is true (staff view only).
 */
export function useReadTracking(
  conversationId: string,
  enabled: boolean,
): {
  observeRef: (messageId: string) => (el: HTMLElement | null) => void;
} {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const latestReadRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elementMapRef = useRef<Map<Element, string>>(new Map());

  const flush = useCallback(() => {
    if (!latestReadRef.current) return;
    const messageId = latestReadRef.current;
    latestReadRef.current = null;

    fetch(`/api/ai/conversations/${conversationId}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ lastReadMessageId: messageId }),
    }).catch(() => {
      // fire-and-forget
    });
  }, [conversationId]);

  useEffect(() => {
    if (!enabled) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const messageId = elementMapRef.current.get(entry.target);
            if (messageId) {
              latestReadRef.current = messageId;

              // Debounce: at most one POST every 2 seconds
              if (!debounceTimerRef.current) {
                debounceTimerRef.current = setTimeout(() => {
                  debounceTimerRef.current = null;
                  flush();
                }, 2000);
              }
            }
          }
        }
      },
      { threshold: 0.5, rootMargin: '0px 0px 100px 0px' },
    );

    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      // Flush any pending read on unmount
      flush();
    };
  }, [enabled, flush]);

  const observeRef = useCallback(
    (messageId: string) => (el: HTMLElement | null) => {
      if (!observerRef.current) return;
      if (el) {
        elementMapRef.current.set(el, messageId);
        observerRef.current.observe(el);
      } else {
        // Cleanup on unmount: unobserve and remove from map
        for (const [existingEl, id] of elementMapRef.current) {
          if (id === messageId) {
            observerRef.current.unobserve(existingEl);
            elementMapRef.current.delete(existingEl);
            break;
          }
        }
      }
    },
    [],
  );

  return { observeRef };
}
