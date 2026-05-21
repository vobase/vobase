import { useEffect, useRef, useState } from 'react'

/**
 * Drives the "linked from `?id=…`" UX on `/changes` rows. Returns:
 *   - `rowRef`        — attach to the outer row element; we scroll it into
 *                       view and pulse a focus ring on it.
 *   - `detailsOpen`   — controlled `open` value for the row's `<details>`;
 *                       defaults to `highlight` so the proposal lands
 *                       already expanded, then mirrors user toggles.
 *   - `onDetailsToggle` — wire to the `<details onToggle>` handler so
 *                       manual open/close keeps state in sync.
 *
 * Why controlled rather than imperative `el.open = true`: when the matched
 * row is rendered inside a Radix `TabsContent` that mounts asynchronously
 * (history tab), the imperative path was racy and the chevron stayed
 * closed. A controlled `open` prop renders correct on first paint.
 */
export function useHighlightRow<T extends HTMLElement>(highlight: boolean) {
  const rowRef = useRef<T>(null)
  const [detailsOpen, setDetailsOpen] = useState<boolean>(highlight)

  useEffect(() => {
    if (!highlight) return
    setDetailsOpen(true)
    const el = rowRef.current
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const ring = ['ring-2', 'ring-primary/60', 'ring-offset-2', 'ring-offset-background', 'transition-shadow']
    el.classList.add(...ring)
    const t = window.setTimeout(() => el.classList.remove(...ring), 2400)
    return () => window.clearTimeout(t)
  }, [highlight])

  const onDetailsToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    setDetailsOpen(e.currentTarget.open)
  }

  return { rowRef, detailsOpen, onDetailsToggle }
}
