import { Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Input } from '@/components/ui/input'
import { type AutocompleteConfig, useAutocomplete } from '@/hooks/useAutocomplete'
import { cn } from '@/lib/utils'

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

interface SearchBarProps {
  initialValue?: string
  onSearch: (query: string) => void
  placeholder?: string
  autoFocus?: boolean
  /** Animated placeholder examples. When provided (and no static placeholder), cycles through these. */
  examples?: string[]
  /** Autocomplete configuration. When provided, enables autocomplete dropdown. */
  autocompleteConfig?: AutocompleteConfig
}

export function SearchBar({
  initialValue = '',
  onSearch,
  placeholder,
  autoFocus = false,
  examples,
  autocompleteConfig,
}: Readonly<SearchBarProps>) {
  const [value, setValue] = useState(initialValue)
  const [displayPlaceholder, setDisplayPlaceholder] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const queueRef = useRef<string[]>([])
  const charTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const defaultConfig: AutocompleteConfig = { seed: [], categories: [] }
  const { suggestions, activeIndex, setActiveIndex, dismiss, resetDismissed } = useAutocomplete(
    value,
    autocompleteConfig ?? defaultConfig,
  )

  // Animated placeholder — only when examples are provided and no explicit placeholder prop
  const animated = placeholder === undefined && examples !== undefined && examples.length > 0

  useEffect(() => {
    if (!animated || !examples) return

    let currentText = ''
    let phase: 'typing' | 'pause' | 'erasing' = 'typing'

    function nextExample() {
      if (queueRef.current.length === 0) queueRef.current = shuffle(examples ?? [])
      return queueRef.current.pop() ?? ''
    }

    let target = nextExample()

    function tick() {
      if (phase === 'typing') {
        if (currentText.length < target.length) {
          currentText = target.slice(0, currentText.length + 1)
          setDisplayPlaceholder(currentText)
          charTimerRef.current = setTimeout(tick, 42)
        } else {
          phase = 'pause'
          charTimerRef.current = setTimeout(tick, 2000)
        }
      } else if (phase === 'pause') {
        phase = 'erasing'
        tick()
      } else {
        if (currentText.length > 0) {
          currentText = currentText.slice(0, -1)
          setDisplayPlaceholder(currentText)
          charTimerRef.current = setTimeout(tick, 22)
        } else {
          target = nextExample()
          phase = 'typing'
          charTimerRef.current = setTimeout(tick, 400)
        }
      }
    }

    charTimerRef.current = setTimeout(tick, 600)
    return () => {
      if (charTimerRef.current) clearTimeout(charTimerRef.current)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [animated, examples])

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const hasDropdown = suggestions.length > 0

    if (e.key === 'ArrowDown' && hasDropdown) {
      e.preventDefault()
      setActiveIndex(Math.min(activeIndex + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp' && hasDropdown) {
      e.preventDefault()
      setActiveIndex(Math.max(activeIndex - 1, -1))
    } else if (e.key === 'Escape' && hasDropdown) {
      e.preventDefault()
      dismiss()
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault()
      const selected = suggestions[activeIndex]
      setValue(selected)
      dismiss()
      onSearch(selected)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    dismiss()
    onSearch(value.trim())
  }

  const showDropdown = suggestions.length > 0
  const effectivePlaceholder = animated ? displayPlaceholder : (placeholder ?? 'Search...')

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="relative w-full">
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={dismiss}
          onFocus={resetDismissed}
          placeholder={effectivePlaceholder}
          className={cn(
            'h-12 w-full pr-20 text-base focus-visible:ring-0 focus-visible:border-border',
            showDropdown && 'rounded-b-none border-b-transparent',
          )}
          autoFocus={autoFocus}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          aria-controls={showDropdown ? 'autocomplete-listbox' : undefined}
          aria-activedescendant={activeIndex >= 0 ? `ac-item-${activeIndex}` : undefined}
        />

        {/* Right-side icons inside the input */}
        <div className="absolute right-0 top-0 flex h-12 items-center gap-0.5 pr-2">
          {value && (
            <button
              type="button"
              aria-label="Clear search"
              onMouseDown={(e) => {
                e.preventDefault()
                setValue('')
                dismiss()
                onSearch('')
                inputRef.current?.focus()
              }}
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground/60 hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
          <button
            type="submit"
            aria-label="Search"
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground/60 hover:bg-accent hover:text-foreground"
          >
            <Search className="size-4" />
          </button>
        </div>

        {/* Dropdown — Google-style: attached seamlessly, search icon per row, bold completion */}
        {showDropdown && (
          <div
            id="autocomplete-listbox"
            role="listbox"
            className="absolute top-full left-0 right-0 z-50 overflow-hidden rounded-b-xl border border-t-0 border-border bg-popover pb-2 shadow-lg"
          >
            <div className="mx-3 border-t border-border/50" />
            {suggestions.map((s, i) => {
              const q = value.trim()
              const isPrefix = s.toLowerCase().startsWith(q.toLowerCase())
              const typed = isPrefix ? s.slice(0, q.length) : ''
              const completion = isPrefix ? s.slice(q.length) : s

              return (
                <button
                  key={s}
                  id={`ac-item-${i}`}
                  type="button"
                  role="option"
                  aria-selected={i === activeIndex}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-accent',
                    i === activeIndex && 'bg-accent',
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    setValue(s)
                    dismiss()
                    onSearch(s)
                  }}
                >
                  <Search className="size-4 shrink-0 text-muted-foreground/60" />
                  <span>
                    <span className="font-medium text-foreground">{typed}</span>
                    <span className="font-normal text-foreground/70">{completion}</span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </form>
  )
}
