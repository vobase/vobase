import { useAgentDefinitions } from '@modules/agents/api/use-agent-definitions'
import { PrincipalAvatar, PrincipalChip, usePrincipalDirectory } from '@modules/messaging/components/principal'
import { useStaffList } from '@modules/team/api/use-staff'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Check, Code2, Copy, ExternalLink, Globe, MoreVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

interface WebInstance {
  id: string
  organizationId: string
  displayName: string | null
  defaultAssignee: string | null
  origin: string | null
  status: string | null
  createdAt: string
}

interface CreateBody {
  displayName: string
  defaultAssignee?: string | null
  origin?: string | null
}

interface UpdateBody {
  displayName?: string
  defaultAssignee?: string | null
  origin?: string | null
}

const listKey = ['channels', 'web', 'instances'] as const

async function fetchInstances(): Promise<WebInstance[]> {
  const r = await fetch('/api/channel-web/instances')
  if (!r.ok) throw new Error(`instances list failed: ${r.status}`)
  return r.json()
}

async function createInstance(body: CreateBody): Promise<WebInstance> {
  const r = await fetch('/api/channel-web/instances', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`instances create failed: ${r.status}`)
  return r.json()
}

async function patchInstance(id: string, body: UpdateBody): Promise<WebInstance> {
  const r = await fetch(`/api/channel-web/instances/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`instances patch failed: ${r.status}`)
  return r.json()
}

async function deleteInstance(id: string): Promise<void> {
  const r = await fetch(`/api/channel-web/instances/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(`instances delete failed: ${r.status}`)
}

function AssigneeSelect({
  value,
  onChange,
  placeholder = 'Unassigned',
}: {
  value: string | null
  onChange: (v: string | null) => void
  placeholder?: string
}) {
  const { data: agents = [] } = useAgentDefinitions()
  const { data: staff = [] } = useStaffList()
  const current = value ?? '__none__'

  return (
    <Select value={current} onValueChange={(next) => onChange(next === '__none__' ? null : next)}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">
          <span className="text-muted-foreground">Unassigned</span>
        </SelectItem>
        {agents.length > 0 && (
          <SelectGroup>
            <SelectLabel>Agents</SelectLabel>
            {agents.map((a) => (
              <SelectItem key={a.id} value={`agent:${a.id}`}>
                <span className="inline-flex items-center gap-2">
                  <PrincipalAvatar kind="agent" size="sm" />
                  {a.name}
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {staff.length > 0 && (
          <SelectGroup>
            <SelectLabel>Staff</SelectLabel>
            {staff.map((s) => (
              <SelectItem key={s.userId} value={`user:${s.userId}`}>
                <span className="inline-flex items-center gap-2">
                  <PrincipalAvatar kind="staff" size="sm" />
                  {s.displayName ?? s.userId}
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  )
}

function InstanceFormDialog({
  open,
  onOpenChange,
  initial,
  title,
  description,
  submitLabel,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  initial: { displayName: string; defaultAssignee: string | null }
  title: string
  description: string
  submitLabel: string
  onSubmit: (body: { displayName: string; defaultAssignee: string | null }) => Promise<void>
}) {
  const [displayName, setDisplayName] = useState(initial.displayName)
  const [assignee, setAssignee] = useState<string | null>(initial.defaultAssignee)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setDisplayName(initial.displayName)
      setAssignee(initial.defaultAssignee)
      setErr(null)
    }
  }, [open, initial.displayName, initial.defaultAssignee])

  async function handleSubmit() {
    setSubmitting(true)
    setErr(null)
    try {
      await onSubmit({ displayName: displayName.trim(), defaultAssignee: assignee })
      onOpenChange(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="channel-name">Name</Label>
            <Input
              id="channel-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Website Chat"
            />
          </div>
          <div className="space-y-2">
            <Label>Default assignee</Label>
            <AssigneeSelect value={assignee} onChange={setAssignee} />
            <p className="text-xs text-muted-foreground">
              New conversations from this channel are routed to this agent or teammate.
            </p>
          </div>
          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!displayName.trim() || submitting}>
            {submitting ? 'Saving…' : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={copy}
      className="absolute right-2 top-2 h-7 gap-1 text-xs"
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  )
}

function ChatLinkField({ instance }: { instance: WebInstance }) {
  const apiOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://yourapp.com'
  const chatUrl = `${apiOrigin}/chat/${encodeURIComponent(instance.id)}`
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(chatUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">Direct chat link</Label>
      <div className="flex items-center gap-1.5">
        <Input
          readOnly
          value={chatUrl}
          className="flex-1 font-mono text-xs"
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={copy}
          aria-label={copied ? 'Copied' : 'Copy link'}
          title={copied ? 'Copied' : 'Copy link'}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => window.open(chatUrl, '_blank', 'noopener,noreferrer')}
          aria-label="Open in new tab"
          title="Open in new tab"
        >
          <ExternalLink className="size-4" />
        </Button>
      </div>
    </div>
  )
}

function EmbedSnippets({ instance }: { instance: WebInstance }) {
  const apiOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://yourapp.com'
  const botName = instance.displayName || 'Support'

  const scriptSnippet = [
    '<script async defer',
    `  src="${apiOrigin}/widget.js"`,
    '  data-vobase-widget',
    `  data-channel-instance-id="${instance.id}"`,
    `  data-bot-name="${botName}"`,
    '  data-color="#6b5b4e">',
    '</script>',
  ].join('\n')

  const jsSnippet = [
    '// Inject the Vobase web widget programmatically',
    "const s = document.createElement('script')",
    `s.src = '${apiOrigin}/widget.js'`,
    's.async = true',
    's.defer = true',
    "s.setAttribute('data-vobase-widget', '')",
    `s.setAttribute('data-channel-instance-id', '${instance.id}')`,
    `s.setAttribute('data-bot-name', ${JSON.stringify(botName)})`,
    "s.setAttribute('data-color', '#6b5b4e')",
    'document.body.appendChild(s)',
  ].join('\n')

  return (
    <Tabs defaultValue="script" className="w-full">
      <TabsList>
        <TabsTrigger value="script" className="gap-1.5">
          <Code2 className="size-3.5" />
          Script tag
        </TabsTrigger>
        <TabsTrigger value="js" className="gap-1.5">
          <Code2 className="size-3.5" />
          JavaScript
        </TabsTrigger>
      </TabsList>
      <TabsContent value="script">
        <SnippetBlock snippet={scriptSnippet} language="html" />
        <p className="mt-2 text-xs text-muted-foreground">
          Paste before <code className="rounded bg-muted px-1 py-0.5">&lt;/body&gt;</code> on any page.
        </p>
      </TabsContent>
      <TabsContent value="js">
        <SnippetBlock snippet={jsSnippet} language="js" />
        <p className="mt-2 text-xs text-muted-foreground">
          Use this when you inject scripts from your SPA or a tag manager.
        </p>
      </TabsContent>
    </Tabs>
  )
}

function SnippetBlock({ snippet, language }: { snippet: string; language: string }) {
  return (
    <div className="relative">
      <pre
        className="overflow-auto rounded-md border border-border bg-muted p-3 font-mono text-xs text-foreground"
        data-language={language}
      >
        {snippet}
      </pre>
      <CopyButton text={snippet} />
    </div>
  )
}

/**
 * Static visual preview of the deployed widget bubble + welcome panel.
 * Mirrors `public/widget.js` styling — this is a passive preview, not a live
 * iframe, so we can render it safely inside the admin page.
 */
function BubblePreview({ instance }: { instance: WebInstance }) {
  const botName = instance.displayName || 'Support'
  const color = '#6b5b4e'

  return (
    <div className="relative h-[360px] w-full overflow-hidden rounded-md border border-border bg-[linear-gradient(135deg,_#f8f7f6,_#eceae8)]">
      <div className="absolute left-4 top-4 text-[10px] uppercase tracking-widest text-muted-foreground">Preview</div>

      {/* Welcome panel */}
      <div className="absolute bottom-[74px] right-4 w-[260px] overflow-hidden rounded-xl bg-white shadow-[0_12px_48px_rgba(0,0,0,0.15),0_4px_16px_rgba(0,0,0,0.08)]">
        <div className="flex items-center gap-3 border-b border-[#e5e5e5] bg-white px-3 py-3">
          <div
            className="flex size-8 items-center justify-center rounded-full text-white"
            style={{ background: color }}
            aria-hidden
          >
            <Globe className="size-4" />
          </div>
          <div className="flex flex-col leading-tight">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[#1a1a1a]">
              {botName}
              <span className="inline-block size-1.5 rounded-full bg-[#22c55e]" />
            </div>
            <div className="text-[10px] text-[#6b7280]">Typically replies in a few minutes</div>
          </div>
        </div>
        <div className="flex min-h-[160px] flex-col justify-end bg-[linear-gradient(180deg,_#f8f7f6,_#fff)] p-3">
          <div className="rounded-lg border border-[#e5e5e5] bg-white p-3 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            <div className="text-[14px] font-semibold text-[#1a1a1a]">Hi there!</div>
            <div className="mt-0.5 text-[11px] text-[#6b7280]">How can we help?</div>
            <div className="mt-3 flex items-center gap-1.5 text-[10px] text-[#6b7280]">
              <span className="inline-block size-1.5 rounded-full bg-[#22c55e]" />
              We are Online
            </div>
            <div className="mt-3 text-[11px] font-semibold text-[#1a1a1a]">Start Conversation →</div>
          </div>
        </div>
        <div className="py-1.5 text-center text-[9px] text-[#9ca3af]">⚡ Powered by Vobase</div>
      </div>

      {/* Bubble */}
      <div
        className="absolute bottom-4 right-4 flex size-[52px] items-center justify-center rounded-full text-white shadow-[0_4px_16px_rgba(0,0,0,0.15),0_2px_4px_rgba(0,0,0,0.1)]"
        style={{ background: color }}
        aria-hidden
      >
        <Globe className="size-5" />
      </div>
    </div>
  )
}

function InstanceCard({
  instance,
  onEdit,
  onDelete,
}: {
  instance: WebInstance
  onEdit: () => void
  onDelete: () => void
}) {
  const dir = usePrincipalDirectory()
  const principal = instance.defaultAssignee ? dir.resolve(instance.defaultAssignee) : null

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex items-start gap-3">
          <div className="flex size-10 items-center justify-center rounded-md bg-muted">
            <Globe className="size-5 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-base">{instance.displayName || 'Untitled channel'}</CardTitle>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{instance.id}</span>
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Default assignee:</span>
              {principal ? (
                <PrincipalChip principal={principal} size="sm" />
              ) : (
                <span className="text-muted-foreground">Unassigned</span>
              )}
            </div>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="size-8 p-0">
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
              <Trash2 className="size-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <ChatLinkField instance={instance} />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <EmbedSnippets instance={instance} />
          <BubblePreview instance={instance} />
        </div>
      </CardContent>
    </Card>
  )
}

export function ChannelsPage() {
  const qc = useQueryClient()
  const { data: instances = [], isLoading } = useQuery({
    queryKey: listKey,
    queryFn: fetchInstances,
  })

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<WebInstance | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<WebInstance | null>(null)

  const createMutation = useMutation({
    mutationFn: createInstance,
    onSuccess: () => qc.invalidateQueries({ queryKey: listKey }),
  })
  const updateMutation = useMutation({
    mutationFn: (args: { id: string; body: UpdateBody }) => patchInstance(args.id, args.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: listKey }),
  })
  const deleteMutation = useMutation({
    mutationFn: deleteInstance,
    onSuccess: () => qc.invalidateQueries({ queryKey: listKey }),
  })

  const editInitial = useMemo(
    () => ({
      displayName: editTarget?.displayName ?? '',
      defaultAssignee: editTarget?.defaultAssignee ?? null,
    }),
    [editTarget],
  )

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Channels</h1>
          <p className="text-sm text-muted-foreground">
            Transport adapters connecting customers to this organization's messaging.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="size-4" />
          Add web channel
        </Button>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          <section>
            <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">Web</h2>

            {isLoading && (
              <div className="space-y-3">
                <Skeleton className="h-[220px] rounded-lg" />
                <Skeleton className="h-[220px] rounded-lg" />
              </div>
            )}

            {!isLoading && instances.length === 0 && (
              <Empty className="border border-dashed">
                <EmptyHeader>
                  <EmptyMedia>
                    <Globe className="size-6 text-muted-foreground" />
                  </EmptyMedia>
                  <EmptyTitle>No web channels yet</EmptyTitle>
                  <EmptyDescription>Create a web channel to embed a chat bubble on any page.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
                    <Plus className="size-4" />
                    Add web channel
                  </Button>
                </EmptyContent>
              </Empty>
            )}

            {!isLoading && instances.length > 0 && (
              <div className="space-y-4">
                {instances.map((i) => (
                  <InstanceCard
                    key={i.id}
                    instance={i}
                    onEdit={() => setEditTarget(i)}
                    onDelete={() => setDeleteTarget(i)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <InstanceFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initial={{ displayName: '', defaultAssignee: null }}
        title="New web channel"
        description="Create a web chat instance you can embed on any page."
        submitLabel="Create channel"
        onSubmit={async (body) => {
          await createMutation.mutateAsync(body)
        }}
      />

      <InstanceFormDialog
        open={!!editTarget}
        onOpenChange={(o) => {
          if (!o) setEditTarget(null)
        }}
        initial={editInitial}
        title="Edit web channel"
        description="Update the name and default assignee for this channel."
        submitLabel="Save changes"
        onSubmit={async (body) => {
          if (!editTarget) return
          await updateMutation.mutateAsync({ id: editTarget.id, body })
          setEditTarget(null)
        }}
      />

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this channel?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className={cn('font-medium text-foreground')}>{deleteTarget?.displayName}</span> will stop accepting
              inbound messages. Existing conversations are preserved but the embed snippet will stop working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!deleteTarget) return
                await deleteMutation.mutateAsync(deleteTarget.id)
                setDeleteTarget(null)
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete channel
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export const Route = createFileRoute('/_app/channels')({
  component: ChannelsPage,
})
