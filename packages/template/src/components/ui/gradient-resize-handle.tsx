import type { ReactNode } from 'react'
import { Separator } from 'react-resizable-panels'

import { useResizeGradient } from '@/hooks/use-resize-gradient'
import { cn } from '@/lib/utils'

interface GradientResizeHandleProps {
  className?: string
  /** Disable drag (and hide visuals); keeps the element in the DOM for stable v4 registration. */
  disabled?: boolean
  /**
   * Optional toggle affordance rendered as a small button centered on the handle.
   * Use to wire panel collapse/expand into the divider itself rather than burning
   * layout space on a dedicated control column.
   */
  toggle?: {
    onClick: () => void
    icon: ReactNode
    label: string
  }
}

/**
 * Panel divider with a cursor-following gradient overlay. The Separator itself
 * is 12px wide so mouse hover fires reliably across the whole hit zone; the
 * static 1px line and gradient render as centered absolute children.
 */
function GradientResizeHandle({ className, disabled, toggle }: GradientResizeHandleProps) {
  const { ref, handlers, gradientStyle } = useResizeGradient()

  return (
    <Separator
      elementRef={ref}
      disabled={disabled}
      onMouseMove={disabled ? undefined : handlers.onMouseMove}
      onMouseLeave={disabled ? undefined : handlers.onMouseLeave}
      className={cn(
        'group/sash relative w-3 shrink-0 cursor-col-resize bg-transparent outline-none ring-0',
        'focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0',
        'data-[separator=active]:outline-none data-[separator=focus]:outline-none',
        disabled && 'pointer-events-none w-0',
        className,
      )}
    >
      {!disabled && (
        <>
          <div className="-translate-x-1/2 pointer-events-none absolute inset-y-0 left-1/2 w-px bg-foreground-10" />
          <div
            className="-translate-x-1/2 pointer-events-none absolute inset-y-0 left-1/2 w-0.5"
            style={gradientStyle}
          />
        </>
      )}
      {toggle && (
        <button
          type="button"
          aria-label={toggle.label}
          title={toggle.label}
          onClick={(e) => {
            e.stopPropagation()
            toggle.onClick()
          }}
          className="-translate-x-1/2 absolute top-12 left-1/2 z-10 inline-flex size-6 cursor-pointer items-center justify-center rounded-full bg-background text-muted-foreground shadow-thin transition-colors hover:text-foreground"
        >
          {toggle.icon}
        </button>
      )}
    </Separator>
  )
}

export type { GradientResizeHandleProps }
export { GradientResizeHandle }
