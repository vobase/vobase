import { useAgentDefinitions } from '@modules/agents/hooks/use-agent-definitions'
import { PrincipalAvatar } from '@modules/messaging/components/principal'
import { useStaffList } from '@modules/team/hooks/use-staff'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ExternalLink, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { PageBody, PageHeader, PageLayout } from '@/components/layout/page-layout'
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
import { channelsClient } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { type ChannelInstanceRow, ChannelsTable } from '../components/channels-table'
import { ConnectWhatsAppSheet } from '../components/connect-whatsapp-sheet'
import { WebChannelDetailsSheet } from '../components/web-channel-details-sheet'
import { WhatsAppEmptyState } from '../components/whatsapp-empty-state'

// ─── Web instance types + fetchers ──────────────────────────────────────────

interface WebInstance {
  id: string
  organizationId: string
  displayName: string | null
  defaultAssignee: string | null
  origin: string | null
  status: string | null
  createdAt: string
}

function toWebInstance(row: ChannelInstanceRow): WebInstance {
  const cfg = row.config ?? {}
  return {
    id: row.id,
    organizationId: row.organizationId,
    displayName: row.displayName,
    defaultAssignee: (cfg.defaultAssignee as string | null) ?? null,
    origin: (cfg.origin as string | null) ?? null,
    status: row.status,
    createdAt: row.createdAt,
  }
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

const ALL_INSTANCES_KEY = ['channels', 'instances', 'all'] as const

async function fetchAllInstances(): Promise<ChannelInstanceRow[]> {
  const r = await channelsClient.instances.$get({ query: {} })
  if (!r.ok) throw new Error(`instances list failed: ${r.status}`)
  const rows = (await r.json()) as ChannelInstanceRow[]
  return rows
}

function configFromCreate(body: CreateBody): Record<string, unknown> {
  const next: { defaultAssignee?: string; origin?: string } = {}
  if (body.defaultAssignee) next.defaultAssignee = body.defaultAssignee
  if (body.origin) next.origin = body.origin
  return next
}

function configPatchFromUpdate(body: UpdateBody): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (body.defaultAssignee !== undefined) patch.defaultAssignee = body.defaultAssignee || null
  if (body.origin !== undefined) patch.origin = body.origin || null
  return patch
}

async function createWebInstance(body: CreateBody): Promise<ChannelInstanceRow> {
  const r = await channelsClient.instances.$post({
    json: { channel: 'web', displayName: body.displayName, config: configFromCreate(body) },
  })
  if (!r.ok) throw new Error(`instances create failed: ${r.status}`)
  return (await r.json()) as ChannelInstanceRow
}

async function patchInstance(id: string, body: UpdateBody): Promise<ChannelInstanceRow> {
  const r = await channelsClient.instances[':id'].$patch({
    param: { id },
    json: { displayName: body.displayName, configPatch: configPatchFromUpdate(body) },
  })
  if (!r.ok) throw new Error(`instances patch failed: ${r.status}`)
  return (await r.json()) as ChannelInstanceRow
}

async function deleteInstance(id: string): Promise<void> {
  const r = await channelsClient.instances[':id'].$delete({ param: { id } })
  if (!r.ok) throw new Error(`instances delete failed: ${r.status}`)
}

// ─── Assignee select ─────────────────────────────────────────────────────────

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

// ─── Web channel form dialog ─────────────────────────────────────────────────

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
            <p className="text-muted-foreground text-xs">
              New conversations from this channel are routed to this agent or teammate.
            </p>
          </div>
          {err && <p className="text-destructive text-xs">{err}</p>}
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

// ─── Main page ───────────────────────────────────────────────────────────────

export function ChannelsPage() {
  const qc = useQueryClient()
  const { data: instances = [], isLoading } = useQuery({
    queryKey: ALL_INSTANCES_KEY,
    queryFn: fetchAllInstances,
  })

  const [connectWaOpen, setConnectWaOpen] = useState(false)
  const [createWebOpen, setCreateWebOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<WebInstance | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<WebInstance | null>(null)
  const [detailsTarget, setDetailsTarget] = useState<string | null>(null)

  const hasWhatsApp = instances.some((i) => i.channel === 'whatsapp')
  const wabaId = instances.find((i) => i.channel === 'whatsapp')?.config.wabaId as string | undefined

  const createMutation = useMutation({
    mutationFn: createWebInstance,
    onSuccess: () => qc.invalidateQueries({ queryKey: ALL_INSTANCES_KEY }),
  })
  const updateMutation = useMutation({
    mutationFn: (args: { id: string; body: UpdateBody }) => patchInstance(args.id, args.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ALL_INSTANCES_KEY }),
  })
  const deleteMutation = useMutation({
    mutationFn: deleteInstance,
    onSuccess: () => qc.invalidateQueries({ queryKey: ALL_INSTANCES_KEY }),
  })

  const editInitial = useMemo(
    () => ({
      displayName: editTarget?.displayName ?? '',
      defaultAssignee: editTarget?.defaultAssignee ?? null,
    }),
    [editTarget],
  )

  function handleWhatsAppConnected(_instanceId: string) {
    qc.invalidateQueries({ queryKey: ALL_INSTANCES_KEY })
  }

  return (
    <PageLayout>
      <PageHeader
        title="Channels"
        description="Transport adapters connecting customers to this organization's messaging."
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                <Plus className="size-4" />
                Add channel
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setConnectWaOpen(true)}>WhatsApp</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setCreateWebOpen(true)}>Web chat</DropdownMenuItem>
              {hasWhatsApp && wabaId && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <a
                      href={`https://business.facebook.com/wa/manage/phone-numbers/?waba_id=${wabaId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="size-4" />
                      Open in Meta WABA Manager
                    </a>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <PageBody>
        {!isLoading && instances.length === 0 ? (
          <WhatsAppEmptyState onConnected={handleWhatsAppConnected} onAddWebChannel={() => setCreateWebOpen(true)} />
        ) : (
          <ChannelsTable
            rows={instances}
            isLoading={isLoading}
            listQueryKey={ALL_INSTANCES_KEY}
            onEditWeb={(row) => setEditTarget(toWebInstance(row))}
            onDeleteWeb={(row) => setDeleteTarget(toWebInstance(row))}
            onOpenDetails={setDetailsTarget}
          />
        )}
      </PageBody>

      {/* WhatsApp connect sheet */}
      <ConnectWhatsAppSheet
        open={connectWaOpen}
        onOpenChange={setConnectWaOpen}
        onConnected={handleWhatsAppConnected}
      />

      {/* Web channel embed sheet */}
      <WebChannelDetailsSheet
        open={!!detailsTarget}
        instanceId={detailsTarget ?? ''}
        onOpenChange={(o) => {
          if (!o) setDetailsTarget(null)
        }}
      />

      {/* Web channel dialogs */}
      <InstanceFormDialog
        open={createWebOpen}
        onOpenChange={setCreateWebOpen}
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
    </PageLayout>
  )
}

export const Route = createFileRoute('/_app/channels')({
  component: ChannelsPage,
})
