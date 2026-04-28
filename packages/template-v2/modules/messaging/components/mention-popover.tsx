/**
 * @-mention popover for plain textarea composers.
 *
 * Detects an unfinished `@<search>` token at the caret (preceded by start-of-
 * line or whitespace, ending with non-whitespace non-@ chars) and renders a
 * filtered principal list anchored above the textarea. Caller owns the text
 * state and the registered-tokens set; this component only:
 *   1. Reads the textarea + value to detect the open mention
 *   2. Captures ↑/↓/Enter/Tab/Esc keys (stopPropagation so the composer
 *      doesn't see them)
 *   3. Calls `onSelect` with the new (value, cursor, token) on selection
 *
 * The caller's onSelect should also remove tokens from its set when the
 * matching `@<Full Name>` substring is no longer present in the body.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import { PrincipalAvatar, type PrincipalDirectory, type PrincipalKind } from '@/components/principal'
import { cn } from '@/lib/utils'

interface MatchState {
  search: string
  /** Index of the `@` character within `value`. */
  atIndex: number
}

interface MentionPopoverProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  value: string
  directory: PrincipalDirectory
  /** Apply the selected mention. Caller updates state (text + tokens). */
  onSelect: (params: { nextValue: string; nextCursor: number; token: string }) => void
}

interface ItemRow {
  kind: PrincipalKind
  token: string
  name: string
}

function detectMention(value: string, cursor: number): MatchState | null {
  const before = value.slice(0, cursor)
  // Walk back from the caret: find the last `@` that's preceded by start or
  // whitespace, with only non-whitespace non-@ chars between it and the caret.
  for (let i = before.length - 1; i >= 0; i--) {
    const ch = before[i]
    if (ch === '@') {
      const prev = i === 0 ? '' : before[i - 1]
      if (prev !== '' && !/\s/.test(prev)) return null
      const search = before.slice(i + 1)
      if (/[\s@]/.test(search)) return null
      return { search, atIndex: i }
    }
    if (/\s/.test(ch)) return null
  }
  return null
}

export function MentionPopover({ textareaRef, value, directory, onSelect }: MentionPopoverProps) {
  const [match, setMatch] = useState<MatchState | null>(null)
  const [active, setActive] = useState(0)

  // Recompute the match whenever the value, caret, or focus changes.
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    const refresh = () => {
      const cursor = ta.selectionStart ?? 0
      const next = detectMention(value, cursor)
      setMatch((prev) => {
        if (prev === null && next === null) return prev
        if (prev && next && prev.atIndex === next.atIndex && prev.search === next.search) return prev
        return next
      })
    }
    const close = () => setMatch(null)
    refresh()
    ta.addEventListener('keyup', refresh)
    ta.addEventListener('mouseup', refresh)
    ta.addEventListener('focus', refresh)
    ta.addEventListener('blur', close)
    return () => {
      ta.removeEventListener('keyup', refresh)
      ta.removeEventListener('mouseup', refresh)
      ta.removeEventListener('focus', refresh)
      ta.removeEventListener('blur', close)
    }
  }, [textareaRef, value])

  const items = useMemo<ItemRow[]>(() => {
    const all: ItemRow[] = [
      ...directory.agents.map((p) => ({ kind: 'agent' as const, token: p.token, name: p.name })),
      ...directory.staff.map((p) => ({ kind: 'staff' as const, token: p.token, name: p.name })),
    ]
    const q = match?.search.toLowerCase() ?? ''
    if (!q) return all
    return all.filter((it) => it.name.toLowerCase().includes(q))
  }, [directory, match?.search])

  // Reset highlight when the match opens, search changes, or list shrinks.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only reset on these
  useEffect(() => {
    setActive(0)
  }, [match?.atIndex, items.length])

  // Keep the active index in range across filter updates.
  const safeActive = items.length === 0 ? 0 : Math.min(active, items.length - 1)

  const insertRef = useRef<((item: ItemRow) => void) | null>(null)
  const insert = (item: ItemRow) => {
    if (!match) return
    const ta = textareaRef.current
    if (!ta) return
    const cursor = ta.selectionStart ?? 0
    const before = value.slice(0, match.atIndex)
    const after = value.slice(cursor)
    const ins = `@${item.name} `
    const next = before + ins + after
    const nextCursor = before.length + ins.length
    onSelect({ nextValue: next, nextCursor, token: item.token })
    setMatch(null)
  }
  insertRef.current = insert

  // Hijack arrow / enter / tab / escape on the textarea while open.
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta || !match) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        setActive((i) => (items.length === 0 ? 0 : (i + 1) % items.length))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setActive((i) => (items.length === 0 ? 0 : (i - 1 + items.length) % items.length))
        return
      }
      if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
        if (items.length === 0) return
        e.preventDefault()
        e.stopPropagation()
        const item = items[safeActive]
        if (item) insertRef.current?.(item)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setMatch(null)
      }
    }
    ta.addEventListener('keydown', onKeyDown)
    return () => ta.removeEventListener('keydown', onKeyDown)
  }, [textareaRef, match, items, safeActive])

  if (!match || items.length === 0) return null

  return (
    <div
      className="absolute right-3 bottom-full left-3 z-50 mb-1 max-h-60 overflow-y-auto rounded-md border bg-popover shadow-md"
      role="listbox"
    >
      {items.map((it, idx) => (
        <button
          key={it.token}
          type="button"
          role="option"
          aria-selected={idx === safeActive}
          className={cn(
            'flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm',
            idx === safeActive ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
          )}
          onMouseDown={(e) => {
            e.preventDefault()
            insert(it)
          }}
          onMouseEnter={() => setActive(idx)}
        >
          <PrincipalAvatar kind={it.kind} />
          <span className="font-medium">{it.name}</span>
          <span className="ml-auto text-muted-foreground text-xs">{it.kind === 'agent' ? 'Agent' : 'Staff'}</span>
        </button>
      ))}
    </div>
  )
}
