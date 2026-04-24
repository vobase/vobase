/**
 * DriveProvider — supplies the current drive scope, current folder (id+path),
 * and selected file path to descendant drive components. Tracks a folder trail
 * (root → current) so breadcrumbs can navigate to any ancestor without
 * re-fetching ids. Separating folder navigation from file selection lets the
 * tree + list panels stay in sync without clobbering the preview.
 */

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import type { DriveScopeArg } from '../api/use-drive'

export interface FolderCrumb {
  id: string | null
  path: string
  name: string
}

const DEFAULT_ROOT_LABEL = 'My Drive'

function rootCrumb(label: string): FolderCrumb {
  return { id: null, path: '/', name: label }
}

interface DriveContextValue {
  scope: DriveScopeArg
  currentFolderId: string | null
  currentFolderPath: string
  folderTrail: FolderCrumb[]
  /** Descend one level into a folder visible in the current list. */
  enterFolder: (crumb: FolderCrumb) => void
  /** Jump to an arbitrary folder (tree click, breadcrumb, reset). */
  jumpToFolder: (crumb: FolderCrumb) => void
  /** Truncate the trail to `index` and navigate to that crumb. */
  jumpToCrumb: (index: number) => void
  selectedPath: string | null
  setSelectedPath: (p: string | null) => void
}

const DriveContext = createContext<DriveContextValue | null>(null)

export interface DriveProviderProps {
  scope: DriveScopeArg
  children: ReactNode
  initialPath?: string | null
  /** Label shown for the root crumb. Defaults to "My Drive". Pass contact or
   *  staff display name when embedding the drive in a detail page. */
  rootLabel?: string
}

export function DriveProvider({
  scope,
  children,
  initialPath = null,
  rootLabel = DEFAULT_ROOT_LABEL,
}: DriveProviderProps) {
  const [folderTrail, setFolderTrail] = useState<FolderCrumb[]>(() => [rootCrumb(rootLabel)])
  const [selectedPath, setSelectedPath] = useState<string | null>(initialPath)

  useEffect(() => {
    setFolderTrail((prev) => {
      if (prev.length === 0) return [rootCrumb(rootLabel)]
      const next = [...prev]
      next[0] = { ...(next[0] as FolderCrumb), name: rootLabel }
      return next
    })
  }, [rootLabel])

  const enterFolder = useCallback((crumb: FolderCrumb) => {
    setFolderTrail((prev) => [...prev, crumb])
  }, [])

  const jumpToFolder = useCallback(
    (crumb: FolderCrumb) => {
      if (crumb.id === null) {
        setFolderTrail([rootCrumb(rootLabel)])
        return
      }
      setFolderTrail([rootCrumb(rootLabel), crumb])
    },
    [rootLabel],
  )

  const jumpToCrumb = useCallback((index: number) => {
    setFolderTrail((prev) => (index < prev.length ? prev.slice(0, index + 1) : prev))
  }, [])

  const current = folderTrail[folderTrail.length - 1] ?? rootCrumb(rootLabel)

  const value = useMemo<DriveContextValue>(
    () => ({
      scope,
      currentFolderId: current.id,
      currentFolderPath: current.path,
      folderTrail,
      enterFolder,
      jumpToFolder,
      jumpToCrumb,
      selectedPath,
      setSelectedPath,
    }),
    [scope, current.id, current.path, folderTrail, enterFolder, jumpToFolder, jumpToCrumb, selectedPath],
  )
  return <DriveContext.Provider value={value}>{children}</DriveContext.Provider>
}

export function useDriveContext(): DriveContextValue {
  const ctx = useContext(DriveContext)
  if (!ctx) throw new Error('useDriveContext: DriveProvider missing')
  return ctx
}
