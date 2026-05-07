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
  /**
   * `'col'` (default) renders a 1px vertical line for a horizontal Group (drag left/right);
   * `'row'` renders a 1px horizontal line for a vertical Group (drag up/down).
   */
  direction?: 'col' | 'row'
}

/**
 * Panel divider — exactly 1px visible line. The Separator element IS the line
 * (its width/height is 1px, its background is the line color), so adjacent panes sit flush.
 * Hover hit zone is the same 1px since extending it with a pseudo-element conflicts with overlay
 * children (e.g. toggle buttons). Render expand/collapse affordances as siblings of the
 * Group, positioned by tracking the list panel's size.
 */
function GradientResizeHandle({ className, disabled, hideLine, direction = 'col' }: GradientResizeHandleProps) {
  const isRow = direction === 'row'
  return (
    <Separator
      disabled={disabled}
      className={cn(
        'group/sash relative shrink-0 bg-foreground-10 outline-none ring-0',
        isRow ? 'h-px w-full cursor-row-resize' : 'w-px cursor-col-resize',
        'focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0',
        'data-[separator=active]:outline-none data-[separator=focus]:outline-none',
        hideLine && 'bg-transparent',
        disabled && (isRow ? 'pointer-events-none h-0 bg-transparent' : 'pointer-events-none w-0 bg-transparent'),
        className,
      )}
    />
  )
}

export type { GradientResizeHandleProps }
export { GradientResizeHandle }
