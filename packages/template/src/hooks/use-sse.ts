import { useEffect, useRef } from 'react'

export interface SseEvent {
  event: string
  data: string
}

type SseHandler = (evt: SseEvent) => void

/**
 * Opens an EventSource to `/api/sse` and calls `onMessage` for every
 * server-sent event. Automatically reconnects on error (browser default).
 * Cleans up on unmount.
 */
export function useSse(onMessage: SseHandler, enabled = true): void {
  const handlerRef = useRef(onMessage)
  handlerRef.current = onMessage

  useEffect(() => {
    if (!enabled) return

    const es = new EventSource('/api/sse')

    const forward = (event: MessageEvent, eventName: string) => {
      handlerRef.current({ event: eventName, data: event.data as string })
    }

    const onInvalidate = (e: MessageEvent) => forward(e, 'invalidate')
    const onPing = (e: MessageEvent) => forward(e, 'ping')
    const onConnected = (e: MessageEvent) => forward(e, 'connected')

    es.addEventListener('invalidate', onInvalidate)
    es.addEventListener('ping', onPing)
    es.addEventListener('connected', onConnected)

    return () => {
      es.removeEventListener('invalidate', onInvalidate)
      es.removeEventListener('ping', onPing)
      es.removeEventListener('connected', onConnected)
      es.close()
    }
  }, [enabled])
}
