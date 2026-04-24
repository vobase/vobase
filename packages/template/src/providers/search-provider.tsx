import { createContext, useContext, useEffect, useState } from 'react'

import { CommandPalette } from '@/shell/command-palette'

type SearchContextType = {
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
}

const SearchContext = createContext<SearchContextType | null>(null)

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <SearchContext value={{ open, setOpen }}>
      {children}
      <CommandPalette />
    </SearchContext>
  )
}

export function useSearch() {
  const ctx = useContext(SearchContext)
  if (!ctx) {
    throw new Error('useSearch must be used within a SearchProvider')
  }
  return ctx
}
