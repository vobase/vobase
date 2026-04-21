/**
 * DriveProvider — supplies the current drive scope + selected path to
 * descendant drive components (Tree, Preview, Upload). Keeps children stateless
 * so they can be composed freely (e.g. DriveBrowser stacks Tree + Preview).
 */

import { createContext, type ReactNode, useContext, useMemo, useState } from 'react'
import type { DriveScopeArg } from '../api/use-drive'

interface DriveContextValue {
  scope: DriveScopeArg
  parentId: string | null
  setParentId: (id: string | null) => void
  selectedPath: string | null
  setSelectedPath: (p: string | null) => void
}

const DriveContext = createContext<DriveContextValue | null>(null)

export interface DriveProviderProps {
  scope: DriveScopeArg
  children: ReactNode
  initialPath?: string | null
}

export function DriveProvider({ scope, children, initialPath = null }: DriveProviderProps) {
  const [parentId, setParentId] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(initialPath)

  const value = useMemo(
    () => ({ scope, parentId, setParentId, selectedPath, setSelectedPath }),
    [scope, parentId, selectedPath],
  )
  return <DriveContext.Provider value={value}>{children}</DriveContext.Provider>
}

export function useDriveContext(): DriveContextValue {
  const ctx = useContext(DriveContext)
  if (!ctx) throw new Error('useDriveContext: DriveProvider missing')
  return ctx
}
