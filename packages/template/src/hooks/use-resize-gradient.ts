import { type CSSProperties, useCallback, useRef, useState } from 'react'

const RESIZE_GRADIENT_EDGE_BUFFER_PX = 64

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function getResizeGradientStyle(mouseY: number | null, handleHeight: number | null): CSSProperties {
  if (mouseY === null || !handleHeight || handleHeight <= 0) {
    return { transition: 'opacity 150ms ease-out', opacity: 0, background: 'none' }
  }

  const height = handleHeight
  const edgeBuffer = Math.min(RESIZE_GRADIENT_EDGE_BUFFER_PX, Math.max(0, Math.floor(height / 2)))
  const centerY = clamp(mouseY, edgeBuffer, height - edgeBuffer)

  const nearDelta = Math.max(20, Math.round(edgeBuffer * 0.22))
  const farDelta = Math.max(56, Math.round(edgeBuffer * 0.75))

  const stopTopNear = clamp(centerY - nearDelta, 0, height)
  const stopTopFar = clamp(centerY - farDelta, 0, height)
  const stopBottomNear = clamp(centerY + nearDelta, 0, height)
  const stopBottomFar = clamp(centerY + farDelta, 0, height)

  return {
    transition: 'opacity 150ms ease-out',
    opacity: 1,
    background: `linear-gradient(
      to bottom,
      transparent 0px,
      color-mix(in oklch, var(--foreground) 10%, transparent) ${stopTopFar}px,
      color-mix(in oklch, var(--foreground) 18%, transparent) ${stopTopNear}px,
      color-mix(in oklch, var(--foreground) 36%, transparent) ${centerY}px,
      color-mix(in oklch, var(--foreground) 18%, transparent) ${stopBottomNear}px,
      color-mix(in oklch, var(--foreground) 10%, transparent) ${stopBottomFar}px,
      transparent ${height}px
    )`,
  }
}

/** Resize handle gradient that follows the cursor along the handle's vertical axis. */
function useResizeGradient() {
  const [mouseY, setMouseY] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    setMouseY(e.clientY - rect.top)
  }, [])

  const onMouseLeave = useCallback(() => {
    setMouseY(null)
  }, [])

  return {
    ref,
    handlers: { onMouseMove, onMouseLeave },
    gradientStyle: getResizeGradientStyle(mouseY, ref.current?.clientHeight ?? null),
  }
}

export { useResizeGradient }
