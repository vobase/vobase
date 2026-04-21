/**
 * Drive TanStack Query hooks.
 *
 * Thin fetch wrappers over `/api/drive/*`. Scope discriminator travels in
 * query params (GETs) or body (writes). Query keys are centralised so SSE
 * invalidation in `use-realtime-invalidation` can target them precisely.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DriveFile } from '../schema'

export type DriveScopeArg = { scope: 'organization' } | { scope: 'contact'; contactId: string }

export interface ReadFileResult {
  content: string
  virtual: boolean
  file: DriveFile | null
}

export const driveKeys = {
  all: ['drive'] as const,
  tree: (s: DriveScopeArg, parentId: string | null) => ['drive', 'tree', scopeKey(s), parentId ?? 'root'] as const,
  file: (s: DriveScopeArg, path: string) => ['drive', 'file', scopeKey(s), path] as const,
}

function scopeKey(s: DriveScopeArg): string {
  return s.scope === 'organization' ? 'organization' : `contact:${s.contactId}`
}

function scopeQuery(s: DriveScopeArg): string {
  return s.scope === 'organization'
    ? 'scope=organization'
    : `scope=contact&contactId=${encodeURIComponent(s.contactId)}`
}

export function useDriveList(scope: DriveScopeArg, parentId: string | null = null) {
  return useQuery({
    queryKey: driveKeys.tree(scope, parentId),
    queryFn: async (): Promise<DriveFile[]> => {
      const q = `${scopeQuery(scope)}${parentId ? `&parentId=${encodeURIComponent(parentId)}` : ''}`
      const r = await fetch(`/api/drive/tree?${q}`)
      if (!r.ok) throw new Error(`drive list failed: ${r.status}`)
      return (await r.json()) as DriveFile[]
    },
  })
}

export function useDriveFile(scope: DriveScopeArg, path: string | null) {
  return useQuery({
    queryKey: path ? driveKeys.file(scope, path) : ['drive', 'file', 'disabled'],
    enabled: Boolean(path),
    queryFn: async (): Promise<ReadFileResult | null> => {
      if (!path) return null
      const q = `${scopeQuery(scope)}&path=${encodeURIComponent(path)}`
      const r = await fetch(`/api/drive/file?${q}`)
      if (r.status === 404) return null
      if (!r.ok) throw new Error(`drive read failed: ${r.status}`)
      const raw = (await r.json()) as ReadFileResult
      return { ...raw, content: stripVirtualHeader(raw.content) }
    },
  })
}

/** Strip the virtual-file sentinel line produced by the backend overlay. The
 *  backend emits `<!-- drive:virtual ... -->` but Plate's markdown roundtrip
 *  can rewrite HTML comments into `{/* ... *\/}` MDX form, so match either. */
function stripVirtualHeader(content: string): string {
  const lines = content.split('\n')
  const filtered = lines.filter((l) => !/drive:virtual\s+field=/.test(l))
  while (filtered.length > 0 && filtered[0] === '') filtered.shift()
  return filtered.join('\n')
}

export function useWriteFile(scope: DriveScopeArg) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ path, content }: { path: string; content: string }) => {
      const body =
        scope.scope === 'organization' ? { scope: 'organization' } : { scope: 'contact', contactId: scope.contactId }
      const r = await fetch('/api/drive/file', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, path, content }),
      })
      if (!r.ok) throw new Error(`drive write failed: ${r.status}`)
      return (await r.json()) as { file: DriveFile }
    },
    onSuccess: (_, { path }) => {
      qc.invalidateQueries({ queryKey: ['drive', 'tree', scopeKey(scope)] })
      qc.invalidateQueries({ queryKey: driveKeys.file(scope, path) })
    },
  })
}

export function useMkdir(scope: DriveScopeArg) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (path: string) => {
      const body =
        scope.scope === 'organization' ? { scope: 'organization' } : { scope: 'contact', contactId: scope.contactId }
      const r = await fetch('/api/drive/folders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, path }),
      })
      if (!r.ok) throw new Error(`drive mkdir failed: ${r.status}`)
      return (await r.json()) as { file: DriveFile }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drive', 'tree', scopeKey(scope)] })
    },
  })
}

export function useRemoveFile(scope: DriveScopeArg) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/drive/file/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(`drive remove failed: ${r.status}`)
      return (await r.json()) as { ok: boolean; id: string }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drive', 'tree', scopeKey(scope)] })
    },
  })
}

export function useMoveFile(scope: DriveScopeArg) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, newPath }: { id: string; newPath: string }) => {
      const r = await fetch('/api/drive/moves', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, newPath }),
      })
      if (!r.ok) throw new Error(`drive move failed: ${r.status}`)
      return (await r.json()) as { file: DriveFile }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drive', 'tree', scopeKey(scope)] })
    },
  })
}
