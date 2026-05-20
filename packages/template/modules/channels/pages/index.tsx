import { useAgentDefinitions } from '@modules/agents/hooks/use-agent-definitions'
import type { ManagedChannelKind } from '@modules/channels/managed/registry'
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
import { ConnectManagedChannelDialog } from '../components/connect-managed-channel-dialog'
import { ConnectWhatsAppSheet } from '../components/connect-whatsapp-sheet'
import { WebChannelDetailsSheet } from '../components/web-channel-details-sheet'
import { WhatsAppEmptyState } from '../components/whatsapp-empty-state'

// Gates the "Platform sandbox" Add-channel item — without a configured
// platform there's nothing to claim from, and the menu item would just 503.
const PLATFORM_CONFIGURED = Boolean(import.meta.env.VITE_PLATFORM_URL)

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

// Pool availability — `null` when the platform isn't reachable or hasn't
// responded yet; UI treats null as "unknown, don't gate the button".
async function fetchSandboxAvailability(): Promise<number | null> {
  const r = await channelsClient.whatsapp.managed.availability.$get()
  if (!r.ok) return null
  const data = (await r.json()) as { sandboxPoolAvailable: number; configured: boolean }
  return data.configured ? data.sandboxPoolAvailable : null
}

async function fetchNotifAvailability(): Promise<number | null> {
  const r = await channelsClient.whatsapp.managed.notification.availability.$get()
  if (!r.ok) return null
  const data = (await r.json()) as { notificationPoolAvailable: number; configured: boolean }
  return data.configured ? data.notificationPoolAvailable : null
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
  // Availability for the two managed kinds — gates the placeholder rows'
  // Connect button so an exhausted pool surfaces in the UI instead of
  // throwing a 503 on click. Disabled entirely when the tenant isn't wired
  // to a platform; the placeholders themselves are suppressed in that case.
  const { data: sandboxAvailable = null } = useQuery({
    queryKey: ['channels', 'managed', 'availability', 'sandbox'] as const,
    queryFn: fetchSandboxAvailability,
    enabled: PLATFORM_CONFIGURED,
    staleTime: 30_000,
  })
  const { data: notifAvailable = null } = useQuery({
    queryKey: ['channels', 'managed', 'availability', 'notification'] as const,
    queryFn: fetchNotifAvailability,
    enabled: PLATFORM_CONFIGURED,
    staleTime: 30_000,
  })

  const [connectWaOpen, setConnectWaOpen] = useState(false)
  // Single state for both managed-kind connect dialogs (sandbox + notification).
  // Triggered from the in-table placeholder rows' "Connect" button.
  const [connectKind, setConnectKind] = useState<ManagedChannelKind | null>(null)
  const [createWebOpen, setCreateWebOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<WebInstance | null>(null)
  // Managed-WhatsApp edit target — separate from `editTarget` because managed
  // rows aren't `WebInstance`-shaped (no `origin` field, different URL bases).
  // The dialog itself stays generic since it only edits `displayName +
  // defaultAssignee`; only the submit path differs.
  const [editManagedTarget, setEditManagedTarget] = useState<ChannelInstanceRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<WebInstance | null>(null)
  const [detailsTarget, setDetailsTarget] = useState<string | null>(null)

  const hasWhatsApp = instances.some((i) => i.channel === 'whatsapp')
  const hasWhatsAppNotif = instances.some((i) => i.channel === 'whatsapp_notif')
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

  function handleWhatsAppConnected(_instanceId?: string) {
    qc.invalidateQueries({ queryKey: ALL_INSTANCES_KEY })
  }

  // Synthetic "placeholder" rows for managed kinds the org hasn't claimed
  // yet. They render in the table with a "Connect" button so operators don't
  // have to discover the kind from a dropdown. Suppressed entirely when the
  // tenant isn't wired to a platform (no `VITE_PLATFORM_URL`).
  //
  // Rows are then sorted by `groupRank` so the two platform-managed rows
  // (sandbox + notification — real or placeholder) always sit at the bottom
  // of the table, regardless of how the API ordered the underlying instances.
  const tableRows = useMemo<ChannelInstanceRow[]>(() => {
    const all: ChannelInstanceRow[] = [...instances]
    if (PLATFORM_CONFIGURED) {
      if (!instances.some((i) => i.channel === 'whatsapp' && i.config.mode === 'managed')) {
        all.push({
          id: '__placeholder__-sandbox',
          organizationId: '',
          channel: 'whatsapp',
          displayName: 'Platform sandbox',
          config: { mode: 'managed' },
          status: null,
          createdAt: '',
          updatedAt: '',
          placeholderKind: 'sandbox',
          placeholderAvailable: sandboxAvailable,
        })
      }
      if (!hasWhatsAppNotif) {
        all.push({
          id: '__placeholder__-notification',
          organizationId: '',
          channel: 'whatsapp_notif',
          displayName: 'Platform notification',
          config: { mode: 'managed-notif' },
          status: null,
          createdAt: '',
          updatedAt: '',
          placeholderKind: 'notification',
          placeholderAvailable: notifAvailable,
        })
      }
    }
    const groupRank = (row: ChannelInstanceRow): number => {
      if (row.channel === 'whatsapp_notif') return 3
      if (row.channel === 'whatsapp' && row.config.mode === 'managed') return 2
      if (row.channel === 'whatsapp') return 1
      return 0
    }
    return all.sort((a, b) => groupRank(a) - groupRank(b))
  }, [instances, hasWhatsAppNotif, sandboxAvailable, notifAvailable])

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
            rows={tableRows}
            isLoading={isLoading}
            listQueryKey={ALL_INSTANCES_KEY}
            onEditWeb={(row) => setEditTarget(toWebInstance(row))}
            onEditManaged={setEditManagedTarget}
            onDeleteWeb={(row) => setDeleteTarget(toWebInstance(row))}
            onOpenDetails={setDetailsTarget}
            onConnectPlaceholder={setConnectKind}
          />
        )}
      </PageBody>

      {/* WhatsApp connect sheet */}
      <ConnectWhatsAppSheet
        open={connectWaOpen}
        onOpenChange={setConnectWaOpen}
        onConnected={handleWhatsAppConnected}
      />

      {/* Unified platform-channel connect dialog. The `kind` is set when the
          operator clicks "Connect" on a placeholder row in the table. */}
      {connectKind && (
        <ConnectManagedChannelDialog
          open={connectKind !== null}
          kind={connectKind}
          onOpenChange={(o) => {
            if (!o) setConnectKind(null)
          }}
          onConnected={(id) => handleWhatsAppConnected(id)}
        />
      )}

      {/* Managed-WhatsApp edit dialog — same form shape as web (only edits
          displayName + defaultAssignee), but submits via the generic
          PATCH /instances/:id with `configPatch`. */}
      <InstanceFormDialog
        open={!!editManagedTarget}
        onOpenChange={(o) => {
          if (!o) setEditManagedTarget(null)
        }}
        initial={{
          displayName: editManagedTarget?.displayName ?? '',
          defaultAssignee:
            (editManagedTarget?.config as { defaultAssignee?: string | null } | undefined)?.defaultAssignee ?? null,
        }}
        title="Edit channel"
        description="Update the name and default assignee for this WhatsApp channel."
        submitLabel="Save changes"
        onSubmit={async (body) => {
          if (!editManagedTarget) return
          await updateMutation.mutateAsync({ id: editManagedTarget.id, body })
          setEditManagedTarget(null)
        }}
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
