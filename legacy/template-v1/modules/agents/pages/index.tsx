import { MODEL_OPTIONS } from '@modules/agents/mastra/lib/models'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ChevronRight, FolderIcon, LayoutGrid, List, MoreVertical, Plus, Search, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { agentsClient, knowledgeBaseClient } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { AgentAvatar } from './-agent-avatar'
import { FileCard, FileRow } from './-file-row'

interface AgentDef {
  id: string
  name: string
  model: string
  channels: string[] | null
  mode: string | null
  suggestions: string[] | null
}

interface KbDocument {
  id: string
  title: string
  folder: string | null
  sourceType: string
  status: string
  chunkCount: number | null
  createdAt: string
  updatedAt: string
}

interface KbFolder {
  folder: string | null
  count: number
}

function AgentFolderCard({ agent }: { agent: AgentDef }) {
  return (
    <Link
      to="/agents/$agentId"
      params={{ agentId: agent.id }}
      className="group flex flex-col gap-2 rounded-xl border bg-card p-3 hover:bg-accent/50 transition-colors"
    >
      <div className="flex items-start justify-between">
        <AgentAvatar />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 opacity-0 group-hover:opacity-100"
              onClick={(e) => e.preventDefault()}
            >
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>Edit</DropdownMenuItem>
            <DropdownMenuItem>Duplicate</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive">Disable</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div>
        <p className="font-medium text-sm truncate">{agent.name}</p>
        <p className="text-xs text-muted-foreground truncate">
          {agent.model.includes('/') ? agent.model.split('/')[1] : agent.model}
        </p>
      </div>
    </Link>
  )
}

function AgentsIndexPage() {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newModel, setNewModel] = useState('anthropic/claude-sonnet-4-6')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('list')
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())

  const { data: agents = [] } = useQuery<AgentDef[]>({
    queryKey: ['agents'],
    queryFn: async () => {
      const res = await agentsClient.agents.$get()
      if (!res.ok) throw new Error('Failed to fetch agents')
      return res.json() as Promise<AgentDef[]>
    },
  })

  const { data: documents = [] } = useQuery<KbDocument[]>({
    queryKey: ['kb-documents'],
    queryFn: async () => {
      const res = await knowledgeBaseClient.documents.$get()
      if (!res.ok) throw new Error('Failed to fetch documents')
      return res.json() as Promise<KbDocument[]>
    },
  })

  const { data: folders = [] } = useQuery<KbFolder[]>({
    queryKey: ['kb-folders'],
    queryFn: async () => {
      const res = await knowledgeBaseClient.folders.$get()
      if (!res.ok) throw new Error('Failed to fetch folders')
      return res.json() as Promise<KbFolder[]>
    },
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await agentsClient.agents.$post({
        json: { name: newName, model: newModel },
      })
      if (!res.ok) throw new Error('Failed to create agent')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      setCreateOpen(false)
      setNewName('')
      setNewModel('anthropic/claude-sonnet-4-6')
    },
  })

  const [uploadError, setUploadError] = useState<string | null>(null)
  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      await Promise.all(
        files.map(async (file) => {
          const form = new FormData()
          form.append('file', file)
          // biome-ignore lint/style/noRestrictedGlobals: multipart upload — Hono RPC client does not support FormData
          const res = await fetch('/api/knowledge-base/documents', {
            method: 'POST',
            credentials: 'include',
            body: form,
          })
          if (!res.ok) {
            const body = await res.text().catch(() => '')
            throw new Error(`Upload failed (${res.status}): ${body}`)
          }
        }),
      )
    },
    onSuccess: () => {
      setUploadError(null)
      queryClient.invalidateQueries({ queryKey: ['kb-documents'] })
      queryClient.invalidateQueries({ queryKey: ['kb-folders'] })
    },
    onError: (err) => {
      setUploadError(err instanceof Error ? err.message : String(err))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await knowledgeBaseClient.documents[':id'].$delete({
        param: { id },
      })
      if (!res.ok) throw new Error('Delete failed')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kb-documents'] })
      queryClient.invalidateQueries({ queryKey: ['kb-folders'] })
    },
  })

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files
    if (fileList && fileList.length > 0) {
      uploadMutation.mutate(Array.from(fileList))
    }
    e.target.value = ''
  }

  function toggleFolder(key: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const { folderMap, rootDocs, orderedFolders } = useMemo(() => {
    const lowerSearch = search.toLowerCase()
    const filtered = documents.filter((d) => d.title.toLowerCase().includes(lowerSearch))
    const fMap = new Map<string, KbDocument[]>()
    const roots: KbDocument[] = []
    for (const doc of filtered) {
      if (doc.folder) {
        const list = fMap.get(doc.folder) ?? []
        list.push(doc)
        fMap.set(doc.folder, list)
      } else {
        roots.push(doc)
      }
    }
    const ordered = folders.filter((f) => f.folder !== null).map((f) => f.folder as string)
    return { folderMap: fMap, rootDocs: roots, orderedFolders: ordered }
  }, [documents, folders, search])

  return (
    <div className="p-6 space-y-8">
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-muted-foreground">Agents</h2>
          <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4 mr-1" />
            New Agent
          </Button>
        </div>

        {agents.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No agents configured yet.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {agents.map((agent) => (
              <AgentFolderCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-muted-foreground">Knowledge Base</h2>
          <div className="flex items-center gap-2">
            <input
              id="kb-upload-input"
              type="file"
              multiple
              style={{
                position: 'absolute',
                left: '-9999px',
                width: 1,
                height: 1,
                opacity: 0,
              }}
              onChange={handleFileChange}
              disabled={uploadMutation.isPending}
            />
            <label
              htmlFor="kb-upload-input"
              className={cn(
                'inline-flex h-8 items-center gap-1 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground cursor-pointer',
                uploadMutation.isPending && 'opacity-50 pointer-events-none',
              )}
            >
              <Upload className="size-4" />
              {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
            </label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search..."
                className="h-8 w-48 pl-7"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex border rounded-md">
              <Button
                size="icon"
                variant={view === 'grid' ? 'secondary' : 'ghost'}
                className="size-8 rounded-r-none"
                onClick={() => setView('grid')}
              >
                <LayoutGrid className="size-4" />
              </Button>
              <Button
                size="icon"
                variant={view === 'list' ? 'secondary' : 'ghost'}
                className="size-8 rounded-l-none"
                onClick={() => setView('list')}
              >
                <List className="size-4" />
              </Button>
            </div>
          </div>
        </div>

        {uploadError && <p className="mb-2 text-sm text-destructive">{uploadError}</p>}

        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No documents in the knowledge base yet.</p>
        ) : view === 'grid' ? (
          <div className="space-y-4">
            {orderedFolders.map((folderName) => {
              const folderDocs = folderMap.get(folderName) ?? []
              if (search && folderDocs.length === 0) return null
              return (
                <div key={folderName}>
                  <div className="flex items-center gap-2 mb-2">
                    <FolderIcon className="size-4 text-emerald-500" />
                    <span className="text-sm font-medium">{folderName}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    {folderDocs.map((doc) => (
                      <FileCard
                        key={doc.id}
                        name={doc.title}
                        icon="amber"
                        updatedAt={doc.updatedAt}
                        status={doc.status}
                        subtitle={doc.chunkCount !== null ? `${doc.chunkCount} chunks` : undefined}
                        to="/agents/kb/$id"
                        linkParams={{ id: doc.id }}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
            {rootDocs.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {rootDocs.map((doc) => (
                  <FileCard
                    key={doc.id}
                    name={doc.title}
                    icon="amber"
                    updatedAt={doc.updatedAt}
                    status={doc.status}
                    subtitle={doc.chunkCount !== null ? `${doc.chunkCount} chunks` : undefined}
                    to="/agents/kb/$id"
                    linkParams={{ id: doc.id }}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-0.5">
            {orderedFolders.map((folderName) => {
              const folderDocs = folderMap.get(folderName) ?? []
              if (search && folderDocs.length === 0) return null
              const isExpanded = expandedFolders.has(folderName)
              const displayCount = search
                ? folderDocs.length
                : (folders.find((f) => f.folder === folderName)?.count ?? folderDocs.length)
              return (
                <div key={folderName}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 rounded-lg hover:bg-accent/50 cursor-pointer text-left"
                    onClick={() => toggleFolder(folderName)}
                  >
                    <ChevronRight
                      className={cn('size-4 transition-transform text-muted-foreground', isExpanded && 'rotate-90')}
                    />
                    <FolderIcon className="size-4 text-emerald-500" />
                    <span className="text-sm font-medium">{folderName}</span>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {displayCount} {displayCount === 1 ? 'file' : 'files'}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="ml-6 space-y-0.5">
                      {folderDocs.map((doc) => (
                        <FileRow
                          key={doc.id}
                          name={doc.title}
                          icon="amber"
                          updatedAt={doc.updatedAt}
                          status={doc.status}
                          subtitle={doc.chunkCount !== null ? `${doc.chunkCount} chunks` : undefined}
                          to="/agents/kb/$id"
                          linkParams={{ id: doc.id }}
                          menuItems={
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => deleteMutation.mutate(doc.id)}
                            >
                              Delete
                            </DropdownMenuItem>
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}

            {rootDocs.map((doc) => (
              <FileRow
                key={doc.id}
                name={doc.title}
                icon="amber"
                updatedAt={doc.updatedAt}
                status={doc.status}
                subtitle={doc.chunkCount !== null ? `${doc.chunkCount} chunks` : undefined}
                to="/agents/kb/$id"
                linkParams={{ id: doc.id }}
                menuItems={
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => deleteMutation.mutate(doc.id)}
                  >
                    Delete
                  </DropdownMenuItem>
                }
              />
            ))}
          </div>
        )}
      </section>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Agent</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Support Agent" />
            </div>
            <div className="space-y-1.5">
              <Label>Model</Label>
              <Select value={newModel} onValueChange={setNewModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => createMutation.mutate()} disabled={!newName || createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Create Agent'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export const Route = createFileRoute('/_app/agents/')({
  component: AgentsIndexPage,
})
