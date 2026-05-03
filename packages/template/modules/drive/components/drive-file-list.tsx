/**
 * DriveFileList — Google-Drive-style single pane. Per-row actions (rename,
 * delete, download-original) sit as an absolutely-positioned sibling of the
 * row button so HTML's "no button-in-button" rule isn't violated.
 */

import {
  ChevronRight,
  Download,
  File,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  Image as ImageIcon,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react'
import { type DragEvent, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { RelativeTimeCard } from '@/components/ui/relative-time'
import { useDriveList, useMkdir, useMoveFile, useRemoveFile, useUploadFile, useWriteFile } from '../hooks/use-drive'
import { extOf } from '../lib/extract'
import type { DriveFile } from '../schema'
import { isVirtualId } from '../service/virtual-ids'
import { type FolderCrumb, useDriveContext } from './drive-provider'
import { DriveStatusPill } from './drive-status-pill'

type NewMode = 'idle' | 'file' | 'folder'
interface RenameState {
  id: string
  value: string
}

const ROW_GRID =
  'grid w-full grid-cols-[1fr_180px_120px] items-center gap-4 border-border/40 border-b px-6 py-2.5 text-left text-sm'

/** Display path differs from original bytes ⇒ row was auto-converted to markdown. */
function isAutoConverted(row: DriveFile): boolean {
  if (!row.originalName || !row.storageKey) return false
  return extOf(row.path) !== extOf(row.originalName)
}

export function DriveFileList() {
  const {
    scope,
    currentFolderId,
    currentFolderPath,
    folderTrail,
    enterFolder,
    jumpToCrumb,
    selectedPath,
    setSelectedPath,
  } = useDriveContext()
  const { data: rows = [], isLoading, error } = useDriveList(scope, currentFolderId)
  const writeFile = useWriteFile(scope)
  const mkdir = useMkdir(scope)
  const uploadFile = useUploadFile(scope)
  const moveFile = useMoveFile(scope)
  const removeFile = useRemoveFile(scope)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [newMode, setNewMode] = useState<NewMode>('idle')
  const [newName, setNewName] = useState('')
  const [dragDepth, setDragDepth] = useState(0)
  const [pendingUploads, setPendingUploads] = useState(0)
  const [rename, setRename] = useState<RenameState | null>(null)
  const [deletingRow, setDeletingRow] = useState<DriveFile | null>(null)

  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
        return a.name.localeCompare(b.name)
      }),
    [rows],
  )

  async function submitNew() {
    const trimmed = newName.trim()
    if (!trimmed) return
    const base = currentFolderPath === '/' ? '' : currentFolderPath.replace(/\/$/, '')
    const path = `${base}/${trimmed.replace(/^\/+/, '')}`
    if (newMode === 'file') await writeFile.mutateAsync({ path, content: '' })
    else if (newMode === 'folder') await mkdir.mutateAsync(path)
    setNewMode('idle')
    setNewName('')
  }

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files)
    if (list.length === 0) return
    setPendingUploads((n) => n + list.length)
    let okCount = 0
    for (const file of list) {
      try {
        await uploadFile.mutateAsync({ file, basePath: currentFolderPath })
        okCount += 1
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error'
        toast.error(`Upload failed: ${file.name}`, { description: msg })
      } finally {
        setPendingUploads((n) => Math.max(0, n - 1))
      }
    }
    if (okCount > 0) {
      toast.success(okCount === 1 ? 'File uploaded' : `${okCount} files uploaded`)
    }
  }

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (files && files.length > 0) void uploadFiles(files)
    e.target.value = ''
  }

  function hasFilesPayload(e: DragEvent<HTMLElement>): boolean {
    return Array.from(e.dataTransfer?.types ?? []).includes('Files')
  }

  function onDragEnter(e: DragEvent<HTMLElement>) {
    if (!hasFilesPayload(e)) return
    e.preventDefault()
    setDragDepth((d) => d + 1)
  }

  function onDragOver(e: DragEvent<HTMLElement>) {
    if (!hasFilesPayload(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  function onDragLeave(e: DragEvent<HTMLElement>) {
    if (!hasFilesPayload(e)) return
    setDragDepth((d) => Math.max(0, d - 1))
  }

  function onDrop(e: DragEvent<HTMLElement>) {
    if (!hasFilesPayload(e)) return
    e.preventDefault()
    setDragDepth(0)
    if (e.dataTransfer.files.length > 0) void uploadFiles(e.dataTransfer.files)
  }

  function startRename(row: DriveFile) {
    setRename({ id: row.id, value: row.name })
  }

  async function commitRename(row: DriveFile) {
    const trimmed = rename?.value.trim() ?? ''
    if (!trimmed || trimmed === row.name) {
      setRename(null)
      return
    }
    const parent = row.path.replace(/\/[^/]+$/, '') || '/'
    const newPath = parent === '/' ? `/${trimmed}` : `${parent}/${trimmed}`
    try {
      await moveFile.mutateAsync({ id: row.id, newPath })
      toast.success(`Renamed to ${trimmed}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error'
      toast.error('Rename failed', { description: msg })
    } finally {
      setRename(null)
    }
  }

  async function commitDelete() {
    const row = deletingRow
    if (!row) return
    try {
      await removeFile.mutateAsync(row.id)
      if (selectedPath === row.path) setSelectedPath(null)
      toast.success(`Deleted ${row.name}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error'
      toast.error('Delete failed', { description: msg })
    } finally {
      setDeletingRow(null)
    }
  }

  return (
    <section
      aria-label="Drive files"
      className="relative flex h-full flex-col bg-background"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onPickFiles}
        aria-hidden="true"
        tabIndex={-1}
      />
      <header className="shrink-0 border-border border-b">
        <div className="flex items-center justify-between gap-3 px-6 pt-4 pb-3">
          <Breadcrumbs trail={folderTrail} onJump={jumpToCrumb} />
          <div className="flex items-center gap-2">
            {pendingUploads > 0 && (
              <span className="text-muted-foreground text-xs">
                Uploading {pendingUploads}
                {pendingUploads === 1 ? ' file…' : ' files…'}
              </span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="gap-1.5">
                  <Plus className="size-4" />
                  New
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
                  <Upload className="size-4" /> Upload file
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setNewMode('folder')
                    setNewName('')
                  }}
                >
                  <FolderPlus className="size-4" /> New folder
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setNewMode('file')
                    setNewName('')
                  }}
                >
                  <FilePlus className="size-4" /> New file
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {newMode !== 'idle' && (
          <div className="flex items-center gap-2 border-border border-t bg-muted/30 px-6 py-2">
            <span className="text-muted-foreground text-xs">
              {newMode === 'folder' ? 'New folder in' : 'New file in'}{' '}
              <span className="font-mono text-foreground">{currentFolderPath}</span>
            </span>
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={newMode === 'file' ? 'filename.md' : 'folder name'}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitNew()
                if (e.key === 'Escape') {
                  setNewMode('idle')
                  setNewName('')
                }
              }}
              className="h-8 max-w-xs text-sm"
            />
            <Button size="sm" onClick={() => void submitNew()} disabled={!newName.trim()}>
              Create
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setNewMode('idle')
                setNewName('')
              }}
            >
              Cancel
            </Button>
          </div>
        )}
        <div className="grid grid-cols-[1fr_180px_120px] gap-4 border-border border-t bg-muted/20 px-6 py-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
          <span>Name</span>
          <span>Last modified</span>
          <span className="text-right">Size</span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading && <div className="p-6 text-muted-foreground text-sm">Loading…</div>}
        {error && <div className="p-6 text-destructive text-sm">Failed to load folder</div>}
        {!isLoading && !error && sorted.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyMedia>
                <Folder className="size-6" />
              </EmptyMedia>
              <EmptyTitle>This folder is empty</EmptyTitle>
              <EmptyDescription>Drop files here, or use the New menu to upload or create.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        <ul>
          {sorted.map((row) => {
            const isFolder = row.kind === 'folder'
            const isSelected = !isFolder && row.path === selectedPath
            const isVirtual = isVirtualId(row.id)
            const isRenaming = rename?.id === row.id
            const showDownload = !isFolder && !isVirtual && isAutoConverted(row)
            const showActions = !isVirtual

            function activate() {
              if (isRenaming) return
              if (isFolder) enterFolder({ id: row.id, path: row.path, name: row.name })
              else setSelectedPath(row.path)
            }

            return (
              <li key={row.id} className={`group relative ${isSelected ? 'bg-primary/5' : ''}`}>
                {isRenaming ? (
                  <div className="flex items-center gap-3 border-border/40 border-b px-6 py-2.5">
                    <FileIcon file={row} />
                    <Input
                      autoFocus
                      value={rename?.value ?? ''}
                      onChange={(e) => setRename({ id: row.id, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void commitRename(row)
                        if (e.key === 'Escape') setRename(null)
                      }}
                      onBlur={() => void commitRename(row)}
                      className="h-7 max-w-sm text-sm"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={activate}
                    onDoubleClick={() => {
                      if (isFolder) enterFolder({ id: row.id, path: row.path, name: row.name })
                    }}
                    className={`${ROW_GRID} ${showActions ? 'pr-20' : ''} hover:bg-muted/60`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <FileIcon file={row} />
                      <span className="truncate">{row.name}</span>
                      {!isFolder && !isVirtual && row.extractionKind !== 'extracted' && (
                        <DriveStatusPill
                          kind={row.extractionKind}
                          error={row.processingError}
                          className="ml-1 shrink-0"
                        />
                      )}
                    </span>
                    <span className="truncate text-muted-foreground text-xs">
                      {new Date(row.updatedAt).getTime() === 0 ? '—' : <RelativeTimeCard date={row.updatedAt} />}
                    </span>
                    <span className="text-right text-muted-foreground text-xs">
                      {isFolder ? '—' : row.sizeBytes !== null ? formatSize(row.sizeBytes) : '—'}
                    </span>
                  </button>
                )}
                {showActions && !isRenaming && (
                  <span className="absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    {showDownload && (
                      <a
                        href={`/api/drive/file/${row.id}/raw`}
                        download={row.originalName ?? undefined}
                        title={`Download original (${row.originalName})`}
                        className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Download className="size-3.5" />
                        <span className="sr-only">Download original</span>
                      </a>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7" aria-label={`Actions for ${row.name}`}>
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => startRename(row)}>
                          <Pencil className="size-4" /> Rename
                        </DropdownMenuItem>
                        {showDownload && (
                          <DropdownMenuItem asChild>
                            <a href={`/api/drive/file/${row.id}/raw`} download={row.originalName ?? undefined}>
                              <Download className="size-4" /> Download original
                            </a>
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem variant="destructive" onSelect={() => setDeletingRow(row)}>
                          <Trash2 className="size-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      {dragDepth > 0 && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-primary/10 backdrop-blur-[1px]"
          aria-hidden="true"
        >
          <div className="flex flex-col items-center gap-2 rounded-lg border-2 border-primary/40 border-dashed bg-background/80 px-8 py-6 text-center">
            <Upload className="size-7 text-primary" />
            <span className="font-medium text-sm">Drop to upload</span>
            <span className="text-muted-foreground text-xs">
              Files will be saved in <span className="font-mono">{currentFolderPath}</span>
            </span>
          </div>
        </div>
      )}

      <AlertDialog open={deletingRow !== null} onOpenChange={(open) => !open && setDeletingRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deletingRow?.kind === 'folder' ? 'folder' : 'file'}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingRow?.kind === 'folder'
                ? `"${deletingRow?.name}" and everything inside it will be permanently removed.`
                : `"${deletingRow?.name}" will be permanently removed. This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void commitDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function FileIcon({ file }: { file: DriveFile }) {
  if (file.kind === 'folder') {
    return <Folder className="size-5 shrink-0 fill-sky-500/20 text-sky-500" />
  }
  const mime = file.mimeType ?? ''
  if (mime.startsWith('image/')) {
    return <ImageIcon className="size-5 shrink-0 text-violet-500" />
  }
  if (/\.(md|markdown)$/i.test(file.path) || mime === 'text/markdown') {
    return <FileText className="size-5 shrink-0 text-emerald-500" />
  }
  if (mime.startsWith('text/') || /\.(txt|json|yaml|yml|csv)$/i.test(file.path)) {
    return <FileText className="size-5 shrink-0 text-muted-foreground" />
  }
  return <File className="size-5 shrink-0 text-muted-foreground" />
}

function Breadcrumbs({ trail, onJump }: { trail: FolderCrumb[]; onJump: (index: number) => void }) {
  return (
    <nav aria-label="Folder path" className="flex min-w-0 flex-wrap items-center gap-1 text-base">
      {trail.map((crumb, i) => {
        const isLast = i === trail.length - 1
        const label = crumb.name
        return (
          <span key={`${crumb.id ?? 'root'}:${crumb.path}`} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-4 text-muted-foreground" />}
            {isLast ? (
              <span className="truncate px-1 font-semibold tracking-tight">{label}</span>
            ) : (
              <button
                type="button"
                onClick={() => onJump(i)}
                className="truncate rounded-sm px-1 font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {label}
              </button>
            )}
          </span>
        )
      })}
    </nav>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}
