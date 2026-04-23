import { useCallback, useEffect, useRef } from 'react'

export interface UseKeyboardNavOptions {
  context: 'messaging-list' | 'messaging-detail' | 'shell'
  onSelectNext?: () => void
  onSelectPrev?: () => void
  onOpenSelected?: () => void
  onClearSelection?: () => void
  onSubmitComposer?: () => void
  onFocusSearch?: () => void
  onNavigate?: (path: string) => void
  onCloseDialog?: () => void
}

const IGNORED_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

function isInsideCombobox(el: Element | null): boolean {
  return Boolean(el?.closest('[role="combobox"], [role="listbox"]'))
}

function isEditableTarget(target: HTMLElement): boolean {
  if (IGNORED_TAGS.has(target.tagName)) return true
  if (target.contentEditable === 'true') return true
  return false
}

export function createKeyboardNavHandler(opts: UseKeyboardNavOptions) {
  return function onKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement
    if (IGNORED_TAGS.has(target.tagName)) return
    if (typeof document !== 'undefined' && isInsideCombobox(document.activeElement)) return

    // Cmd+Enter must be checked before plain Enter
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      opts.onSubmitComposer?.()
    } else if (e.key === 'j') {
      e.preventDefault()
      opts.onSelectNext?.()
    } else if (e.key === 'k') {
      e.preventDefault()
      opts.onSelectPrev?.()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      opts.onOpenSelected?.()
    } else if (e.key === 'Escape') {
      opts.onClearSelection?.()
    } else if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      opts.onFocusSearch?.()
    }
  }
}

export interface ShellKeyboardNavOptions {
  onNavigate?: (path: string) => void
  onCloseDialog?: () => void
}

export function createShellKeyboardNavHandler(opts: ShellKeyboardNavOptions) {
  let pendingG = false
  let timer: ReturnType<typeof setTimeout> | null = null

  function clearPending() {
    pendingG = false
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  return {
    handler(e: KeyboardEvent): void {
      const target = e.target as HTMLElement
      if (isEditableTarget(target)) return
      if (typeof document !== 'undefined' && isInsideCombobox(document.activeElement)) return

      if (e.key === 'Escape') {
        opts.onCloseDialog?.()
        clearPending()
        return
      }

      if (pendingG) {
        clearPending()
        if (e.key === 's') {
          e.preventDefault()
          opts.onNavigate?.('/settings')
        } else if (e.key === 'i' || e.key === 'h') {
          e.preventDefault()
          opts.onNavigate?.('/messaging')
        }
        return
      }

      if (e.key === 'g' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        pendingG = true
        timer = setTimeout(clearPending, 500)
      }
    },
    reset: clearPending,
  }
}

export function useKeyboardNav(opts: UseKeyboardNavOptions) {
  const optsRef = useRef(opts)
  optsRef.current = opts

  const shellHandlerRef = useRef<ReturnType<typeof createShellKeyboardNavHandler> | null>(null)

  useEffect(() => {
    if (opts.context !== 'shell') return

    shellHandlerRef.current = createShellKeyboardNavHandler({
      get onNavigate() {
        return optsRef.current.onNavigate
      },
      get onCloseDialog() {
        return optsRef.current.onCloseDialog
      },
    })

    function listener(e: KeyboardEvent) {
      shellHandlerRef.current?.handler(e)
    }
    window.addEventListener('keydown', listener)
    return () => {
      shellHandlerRef.current?.reset()
      window.removeEventListener('keydown', listener)
    }
  }, [opts.context])

  useEffect(() => {
    if (opts.context === 'shell') return

    function listener(e: KeyboardEvent) {
      createKeyboardNavHandler(optsRef.current)(e)
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [opts.context])

  return {
    focusSearch: useCallback(() => optsRef.current.onFocusSearch?.(), []),
    selectNext: useCallback(() => optsRef.current.onSelectNext?.(), []),
    selectPrev: useCallback(() => optsRef.current.onSelectPrev?.(), []),
    openSelected: useCallback(() => optsRef.current.onOpenSelected?.(), []),
    clearSelection: useCallback(() => optsRef.current.onClearSelection?.(), []),
    submitComposer: useCallback(() => optsRef.current.onSubmitComposer?.(), []),
  }
}
