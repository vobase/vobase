import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Code2, ExternalLink, MoreVertical, Pencil, QrCode, Trash2, UserCog } from 'lucide-react'
import { useState } from 'react'

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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { channelsClient } from '@/lib/api-client'
import { chatUrlFor, openInNewTab } from './chat-url'
import { ManagedLinkQrSheet } from './managed-link-qr-sheet'

interface ChannelRow {
  id: string
  channel: string
  displayName: string | null
  status: string | null
  config: Record<string, unknown>
}

interface ChannelRowMenuProps {
  row: ChannelRow
  listQueryKey: readonly unknown[]
  onEdit?: () => void
  onDelete?: () => void
  onOpenDetails?: (id: string) => void
}

async function deleteInstance(id: string) {
  const r = await channelsClient.instances[':id'].$delete({ param: { id } })
  if (!r.ok) throw new Error(`delete failed: ${r.status}`)
}

/**
 * Managed-WhatsApp sandbox release. Goes through the dedicated endpoint so
 * the platform-side claim row is released (`releaseWithPlatform`) BEFORE the
 * tenant-side `channel_instances` row is soft-deleted. Calling the generic
 * `DELETE /instances/:id` path for a managed channel would leak the
 * platform claim (orphaning the per-(tenant, env) cap until manual cleanup)
 * AND still hit the same FK constraint on `conversations`.
 */
async function releaseManagedInstance(instanceId: string) {
  const r = await channelsClient.whatsapp.managed[':instanceId'].$delete({ param: { instanceId } })
  if (!r.ok) throw new Error(`release failed: ${r.status}`)
}

function WebRowMenu({ row, onEdit, onDelete, onOpenDetails }: ChannelRowMenuProps) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5"
        onClick={() => openInNewTab(chatUrlFor(row.id))}
        aria-label="Open web channel in new tab"
      >
        <ExternalLink className="size-4" />
        <span className="text-xs">Open</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label="Row actions">
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onOpenDetails?.(row.id)}>
            <Code2 className="size-4" />
            Embed code…
          </DropdownMenuItem>
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
    </div>
  )
}

function WhatsAppRowMenu({ row, listQueryKey, onEdit }: ChannelRowMenuProps) {
  const qc = useQueryClient()
  const [linkQrOpen, setLinkQrOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const config = row.config as {
    wabaId?: string
    mode?: string
    displayPhoneNumber?: string
    endpointId?: string
  }
  // Both managed tiers (sandbox + notification) release through the dedicated
  // platform endpoint. The Link QR, however, is sandbox-only — it's the
  // customer-facing number testers scan to join; the staff notification
  // number has no such opt-in.
  const isManaged = config.mode === 'managed'
  const showLinkQr = config.mode === 'managed' && row.channel === 'whatsapp'
  const wabaId = config.wabaId
  const displayPhoneNumber = config.displayPhoneNumber ?? null
  const endpointId = config.endpointId ?? null

  const deleteMutation = useMutation({
    mutationFn: () => (isManaged ? releaseManagedInstance(row.id) : deleteInstance(row.id)),
    onSuccess: () => {
      setDeleteOpen(false)
      qc.invalidateQueries({ queryKey: listQueryKey })
    },
  })

  return (
    <>
      <div className="flex items-center justify-end gap-1">
        {showLinkQr && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setLinkQrOpen(true)}
            aria-label="Show QR to link tester"
          >
            <QrCode className="size-4" />
            <span className="text-xs">Link QR</span>
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" aria-label="Row actions">
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit} disabled={!onEdit}>
              <UserCog className="size-4" />
              Edit name & default assignee…
            </DropdownMenuItem>
            {wabaId && !isManaged && (
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
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setDeleteOpen(true)} className="text-destructive focus:text-destructive">
              <Trash2 className="size-4" />
              {isManaged ? 'Release' : 'Disconnect'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {showLinkQr && (
        <ManagedLinkQrSheet
          open={linkQrOpen}
          onOpenChange={setLinkQrOpen}
          endpointId={endpointId}
          displayPhoneNumber={displayPhoneNumber}
        />
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isManaged ? 'Release this channel?' : 'Disconnect this channel?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {isManaged
                ? `${row.displayName ?? row.id} will be released from this tenant. The number remains in your WABA.`
                : `${row.displayName ?? row.id} will be disconnected. Existing conversations are preserved but no new messages will be received.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
            >
              {isManaged ? 'Release' : 'Disconnect'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function ChannelRowMenu(props: ChannelRowMenuProps) {
  // `whatsapp_notif` (the staff-notification channel) shares the WhatsApp
  // menu — it is a managed WhatsApp number, not a web channel. Without this
  // it fell through to WebRowMenu and rendered a bogus "Open" chat button.
  if (props.row.channel === 'whatsapp' || props.row.channel === 'whatsapp_notif') {
    return <WhatsAppRowMenu {...props} />
  }
  return <WebRowMenu {...props} />
}
