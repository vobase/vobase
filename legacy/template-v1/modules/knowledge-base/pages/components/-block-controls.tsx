/**
 * Block-level include/exclude controls for the document viewer.
 *
 * Wraps a PlateElement component with a hover overlay that lets users toggle
 * whether a block is included in the search index.
 *
 * The `excluded` flag is stored as a property on the element node itself so
 * it persists when the PlateValue is saved via PATCH /documents/:id/content.
 */
import { type PlateElementProps, useEditorRef } from '@platejs/core/react'
import { Eye, EyeOff } from 'lucide-react'
import type { ReactElement, MouseEvent as ReactMouseEvent } from 'react'

import { cn } from '@/lib/utils'

type ElementComp = ((props: PlateElementProps) => ReactElement | null) & {
  displayName?: string
}

/**
 * HOC that adds a hover overlay with an include/exclude toggle to any
 * PlateElement component. Only apply to top-level block types (headings,
 * paragraphs, etc.) — not to nested elements like td, code_line, lic.
 *
 * PlateElement already applies `position: relative` to the element's style,
 * so the absolute-positioned overlay naturally anchors to the block.
 */
export function withBlockControls(Component: ElementComp): ElementComp {
  function BlockControlled(props: PlateElementProps): ReactElement | null {
    const editor = useEditorRef()
    const isExcluded = Boolean((props.element as { excluded?: boolean }).excluded)

    function handleToggle(e: ReactMouseEvent) {
      e.preventDefault()
      e.stopPropagation()
      editor.tf.setNodes({ excluded: !isExcluded }, { at: props.path })
    }

    return (
      <div className={cn('group', isExcluded && 'opacity-40')}>
        <Component {...props} />
        <span
          contentEditable={false}
          className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center opacity-0 transition-opacity select-none group-hover:opacity-100"
        >
          <button
            type="button"
            onClick={handleToggle}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            title={isExcluded ? 'Include in search index' : 'Exclude from search index'}
          >
            {isExcluded ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </button>
        </span>
      </div>
    )
  }

  BlockControlled.displayName = `BlockControlled(${Component.displayName ?? Component.name ?? 'Element'})`
  return BlockControlled
}
