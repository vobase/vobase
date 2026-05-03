/**
 * Drive TanStack Query hooks.
 *
 * Wraps `driveClient` (Hono RPC) over `/api/drive/*`. Scope discriminator
 * travels in query params (GETs) or body (writes). Query keys are centralised
 * so SSE invalidation in `use-realtime-invalidation` can target them precisely.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { driveClient } from '@/lib/api-client'
import type { DriveFile } from '../schema'

export type DriveScopeArg =
  | { scope: 'organization' }
  | { scope: 'contact'; contactId: string }
  | { scope: 'staff'; userId: string }
  | { scope: 'agent'; agentId: string }

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
  if (s.scope === 'organization') return 'organization'
  if (s.scope === 'staff') return `staff:${s.userId}`
  if (s.scope === 'agent') return `agent:${s.agentId}`
  return `contact:${s.contactId}`
}

function scopeQueryParams(s: DriveScopeArg): Record<string, string> {
  if (s.scope === 'organization') return { scope: 'organization' }
  if (s.scope === 'staff') return { scope: 'staff', userId: s.userId }
  if (s.scope === 'agent') return { scope: 'agent', agentId: s.agentId }
  return { scope: 'contact', contactId: s.contactId }
}

function scopeBody(s: DriveScopeArg): Record<string, string> {
  return scopeQueryParams(s)
}

export function useDriveList(scope: DriveScopeArg, parentId: string | null = null) {
  return useQuery({
    queryKey: driveKeys.tree(scope, parentId),
    queryFn: async (): Promise<DriveFile[]> => {
      const query = { ...scopeQueryParams(scope), ...(parentId ? { parentId } : {}) }
      const r = await driveClient.tree.$get({ query })
      if (!r.ok) throw new Error(`drive list failed: ${r.status}`)
      return (await r.json()) as unknown as DriveFile[]
    },
  })
}

export function useDriveFile(scope: DriveScopeArg, path: string | null) {
  return useQuery({
    queryKey: path ? driveKeys.file(scope, path) : ['drive', 'file', 'disabled'],
    enabled: Boolean(path),
    queryFn: async (): Promise<ReadFileResult | null> => {
      if (!path) return null
      const r = await driveClient.file.$get({ query: { ...scopeQueryParams(scope), path } })
      if (r.status === 404) return null
      if (!r.ok) throw new Error(`drive read failed: ${r.status}`)
      const raw = (await r.json()) as unknown as ReadFileResult
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
      const r = await driveClient.file.$put({
        json: { ...scopeBody(scope), path, content } as never,
      })
      if (!r.ok) throw new Error(`drive write failed: ${r.status}`)
      return (await r.json()) as unknown as { file: DriveFile }
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
      const r = await driveClient.folders.$post({
        json: { ...scopeBody(scope), path } as never,
      })
      if (!r.ok) throw new Error(`drive mkdir failed: ${r.status}`)
      return (await r.json()) as unknown as { file: DriveFile }
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
      const r = await driveClient.file[':id'].$delete({ param: { id } })
      if (!r.ok) throw new Error(`drive remove failed: ${r.status}`)
      return (await r.json()) as unknown as { ok: boolean; id: string }
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
      const r = await driveClient.moves.$post({ json: { id, newPath } })
      if (!r.ok) throw new Error(`drive move failed: ${r.status}`)
      return (await r.json()) as unknown as { file: DriveFile }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drive', 'tree', scopeKey(scope)] })
    },
  })
}

export interface UploadFileResult {
  ok: true
  id: string
  path: string
  nameStem: string
  extractionKind: 'pending' | 'extracted' | 'binary-stub' | 'failed'
}

/**
 * Multipart upload hook. Posts to `/api/drive/upload` with the bytes + scope
 * + basePath. Returns the freshly-created drive row id and path. Invalidates
 * the surrounding tree on success so the new row appears.
 *
 * The route expects `multipart/form-data`; this hook builds the FormData here
 * (the typed Hono RPC client doesn't natively model multipart bodies).
 */
export function useUploadFile(scope: DriveScopeArg) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, basePath = '/' }: { file: File; basePath?: string }) => {
      const form = new FormData()
      form.set('file', file)
      const sb = scopeBody(scope)
      form.set('scope', sb.scope ?? 'organization')
      const id = sb.contactId ?? sb.userId ?? sb.agentId
      if (id) form.set('scopeId', id)
      form.set('basePath', basePath)
      // biome-ignore lint/plugin/no-raw-fetch: Hono typed RPC client doesn't model multipart bodies; the upload route is multipart-only.
      const r = await fetch('/api/drive/upload', { method: 'POST', body: form })
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string; message?: string }
        throw new Error(body.message ?? body.error ?? `drive upload failed: ${r.status}`)
      }
      return (await r.json()) as UploadFileResult
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drive', 'tree', scopeKey(scope)] })
    },
  })
}
