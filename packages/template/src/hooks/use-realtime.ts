import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useSyncExternalStore } from 'react';

export type RealtimeStatus = 'connected' | 'connecting' | 'disconnected';

// Simple external store for SSE status so any component can read it
let _status: RealtimeStatus = 'connecting';
const _listeners = new Set<() => void>();

function setStatus(s: RealtimeStatus) {
  if (_status === s) return;
  _status = s;
  for (const fn of _listeners) fn();
}

function subscribe(fn: () => void) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function getSnapshot() {
  return _status;
}

/** Read the current SSE connection status from any component. */
export function useRealtimeStatus(): RealtimeStatus {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'connecting');
}

// ─── Raw payload dispatch (for typing indicators, etc.) ──────────────

export interface RealtimePayload {
  table: string;
  id?: string;
  action?: string;
  tab?: string;
  prevTab?: string;
}

type PayloadListener = (payload: RealtimePayload) => void;
const _payloadListeners = new Set<PayloadListener>();

/** Subscribe to raw SSE payloads from the single shared connection. */
export function subscribeToPayloads(fn: PayloadListener): () => void {
  _payloadListeners.add(fn);
  return () => _payloadListeners.delete(fn);
}

export function useRealtimeInvalidation() {
  const queryClient = useQueryClient();
  const isFirstConnect = useRef(true);

  useEffect(() => {
    setStatus('connecting');
    const es = new EventSource('/api/events');

    es.addEventListener('invalidate', (e) => {
      const payload = JSON.parse(e.data) as RealtimePayload;
      // Dispatch to raw payload subscribers (typing indicators, etc.)
      for (const fn of _payloadListeners) {
        try {
          fn(payload);
        } catch {
          // subscriber errors must not crash the dispatch loop
        }
      }
      // Targeted invalidation for interaction tab events
      if (payload.table === 'interactions' && payload.tab) {
        const tabKey = `interactions-${payload.tab === 'ai' ? 'ai-active' : payload.tab === 'done' ? 'resolved' : 'attention'}`;
        queryClient.invalidateQueries({ queryKey: [tabKey] });
        if (payload.prevTab && payload.prevTab !== payload.tab) {
          const prevKey = `interactions-${payload.prevTab === 'ai' ? 'ai-active' : payload.prevTab === 'done' ? 'resolved' : 'attention'}`;
          queryClient.invalidateQueries({ queryKey: [prevKey] });
        }
        queryClient.invalidateQueries({ queryKey: ['interactions-counts'] });
        if (payload.id) {
          queryClient.invalidateQueries({
            queryKey: ['interaction-detail', payload.id],
          });
        }
        return;
      }
      // Broad invalidation for all other events
      queryClient.invalidateQueries({ queryKey: [payload.table] });
    });

    es.addEventListener('open', () => {
      setStatus('connected');
      if (isFirstConnect.current) {
        isFirstConnect.current = false;
        return;
      }
      // Reconnect — invalidate all to catch missed events
      queryClient.invalidateQueries();
    });

    es.addEventListener('error', () => {
      setStatus('disconnected');
      console.warn('[realtime] SSE connection error, reconnecting...');
    });

    return () => {
      es.close();
      setStatus('disconnected');
      isFirstConnect.current = true;
    };
  }, [queryClient]);
}
