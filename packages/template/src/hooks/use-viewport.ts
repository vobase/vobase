import { useEffect, useState } from 'react'

const MOBILE_QUERY = '(max-width: 767px)'
const TABLET_QUERY = '(min-width: 768px) and (max-width: 1023px)'

type Viewport = 'mobile' | 'tablet' | 'desktop'

function detectViewport(): Viewport {
  if (typeof window === 'undefined') return 'desktop'
  if (window.matchMedia(MOBILE_QUERY).matches) return 'mobile'
  if (window.matchMedia(TABLET_QUERY).matches) return 'tablet'
  return 'desktop'
}

/** Single matchMedia source of truth for layout-level branching. */
function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(detectViewport)

  useEffect(() => {
    const mobile = window.matchMedia(MOBILE_QUERY)
    const tablet = window.matchMedia(TABLET_QUERY)
    const update = () => setViewport(detectViewport())
    mobile.addEventListener('change', update)
    tablet.addEventListener('change', update)
    return () => {
      mobile.removeEventListener('change', update)
      tablet.removeEventListener('change', update)
    }
  }, [])

  return viewport
}

export type { Viewport }
export { useViewport }
