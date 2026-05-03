import { Separator } from 'react-resizable-panels'

import { cn } from '@/lib/utils'

interface GradientResizeHandleProps {
  className?: string
  /** Disable drag (and hide visuals); keeps the element in the DOM for stable v4 registration. */
  disabled?: boolean
  /**
   * Hide the visible line (still drags). Use when this divider would stack with an adjacent
   * border (e.g. a list pane is collapsed to 0 and another rail's divider is just to the left).
   */
  hideLine?: boolean
}

/**
 * Panel divider — exactly 1px visible vertical line. The Separator element IS the line
 * (its width is 1px, its background is the line color), so adjacent panes sit flush. Hover
 * hit zone is the same 1px since extending it with a pseudo-element conflicts with overlay
 * children (e.g. toggle buttons). Render expand/collapse affordances as siblings of the
 * Group, positioned by tracking the list panel's size.
 */
function GradientResizeHandle({ className, disabled, hideLine }: GradientResizeHandleProps) {
  return (
    <Separator
      disabled={disabled}
      className={cn(
        'group/sash relative w-px shrink-0 cursor-col-resize bg-foreground-10 outline-none ring-0',
        'focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0',
        'data-[separator=active]:outline-none data-[separator=focus]:outline-none',
        hideLine && 'bg-transparent',
        disabled && 'pointer-events-none w-0 bg-transparent',
        className,
      )}
    />
  )
}

export type { GradientResizeHandleProps }
export { GradientResizeHandle }
