/**
 * DriveFileList — Google-Drive-style single pane: breadcrumb header, New menu,
 * column headers (Name / Modified / Size), and a row list with colored icons.
 * Clicking a folder descends via the shared folder-trail; clicking a file
 * selects it for the preview pane.
 */

import { ChevronRight, File, FilePlus, FileText, Folder, FolderPlus, Image as ImageIcon, Plus } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { RelativeTimeCard } from '@/components/ui/relative-time'
import { useDriveList, useMkdir, useWriteFile } from '../api/use-drive'
import type { DriveFile } from '../schema'
import { type FolderCrumb, useDriveContext } from './drive-provider'

type NewMode = 'idle' | 'file' | 'folder'

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
  const [newMode, setNewMode] = useState<NewMode>('idle')
  const [newName, setNewName] = useState('')

  const sorted = [...rows].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })

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

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="shrink-0 border-b border-border">
        <div className="flex items-center justify-between gap-3 px-6 pt-4 pb-3">
          <Breadcrumbs trail={folderTrail} onJump={jumpToCrumb} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="gap-1.5">
                <Plus className="size-4" />
                New
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
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
        {newMode !== 'idle' && (
          <div className="flex items-center gap-2 border-t border-border bg-muted/30 px-6 py-2">
            <span className="text-xs text-muted-foreground">
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
        <div className="grid grid-cols-[1fr_180px_120px] gap-4 border-t border-border bg-muted/20 px-6 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>Name</span>
          <span>Last modified</span>
          <span className="text-right">Size</span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading && <div className="p-6 text-sm text-muted-foreground">Loading…</div>}
        {error && <div className="p-6 text-sm text-destructive">Failed to load folder</div>}
        {!isLoading && !error && sorted.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyMedia>
                <Folder className="size-6" />
              </EmptyMedia>
              <EmptyTitle>This folder is empty</EmptyTitle>
              <EmptyDescription>Create a file or folder with the New menu.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        <ul>
          {sorted.map((row) => {
            const isFolder = row.kind === 'folder'
            const isSelected = !isFolder && row.path === selectedPath
            return (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() =>
                    isFolder ? enterFolder({ id: row.id, path: row.path, name: row.name }) : setSelectedPath(row.path)
                  }
                  onDoubleClick={() => {
                    if (isFolder) enterFolder({ id: row.id, path: row.path, name: row.name })
                  }}
                  className={`grid w-full grid-cols-[1fr_180px_120px] items-center gap-4 border-b border-border/40 px-6 py-2.5 text-left text-sm hover:bg-muted/60 ${
                    isSelected ? 'bg-primary/5' : ''
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <FileIcon file={row} />
                    <span className="truncate">{row.name}</span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    <RelativeTimeCard date={row.updatedAt} />
                  </span>
                  <span className="text-right text-xs text-muted-foreground">
                    {isFolder ? '—' : row.sizeBytes !== null ? formatSize(row.sizeBytes) : '—'}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
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
