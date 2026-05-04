import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Code2,
  ExternalLink,
  FileText,
  MoreVertical,
  Pause,
  Play,
  Plug,
  Stethoscope,
  Trash2,
  UserCog,
} from 'lucide-react'
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
import { InstanceDoctorSheet } from './instance-doctor-sheet'
import { TemplatesSheet } from './templates-sheet'

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

async function toggleEnabled(id: string, _organizationId: string, enable: boolean) {
  const r = await channelsClient.instances[':id'].$patch({
    param: { id },
    json: { status: enable ? 'active' : 'paused' },
  })
  if (!r.ok) throw new Error(`toggle failed: ${r.status}`)
}

async function deleteInstance(id: string) {
  const r = await channelsClient.instances[':id'].$delete({ param: { id } })
  if (!r.ok) throw new Error(`delete failed: ${r.status}`)
}

function WebRowMenu({ row, onEdit, onDelete, onOpenDetails }: ChannelRowMenuProps) {
  return (
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
        <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
          <Trash2 className="size-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function WhatsAppRowMenu({ row, listQueryKey }: ChannelRowMenuProps) {
  const qc = useQueryClient()
  const [doctorOpen, setDoctorOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const isPaused = row.status === 'paused'
  const isError = row.status === 'error'
  const config = row.config as { wabaId?: string; mode?: string }
  const isManaged = config.mode === 'managed'
  const wabaId = config.wabaId

  const toggleMutation = useMutation({
    mutationFn: () => toggleEnabled(row.id, '', !isPaused),
    onSuccess: () => qc.invalidateQueries({ queryKey: listQueryKey }),
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteInstance(row.id),
    onSuccess: () => {
      setDeleteOpen(false)
      qc.invalidateQueries({ queryKey: listQueryKey })
    },
  })

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label="Row actions">
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setDoctorOpen(true)}>
            <Stethoscope className="size-4" />
            Run health check
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTemplatesOpen(true)}>
            <FileText className="size-4" />
            Templates…
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <UserCog className="size-4" />
            Reassign default…
          </DropdownMenuItem>
          {wabaId && (
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
          <DropdownMenuItem onClick={() => toggleMutation.mutate()} disabled={toggleMutation.isPending}>
            {isPaused ? (
              <>
                <Play className="size-4" />
                Resume
              </>
            ) : (
              <>
                <Pause className="size-4" />
                Pause
              </>
            )}
          </DropdownMenuItem>
          {isError && (
            <DropdownMenuItem disabled>
              <Plug className="size-4" />
              Reconnect…
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setDeleteOpen(true)} className="text-destructive focus:text-destructive">
            <Trash2 className="size-4" />
            {isManaged ? 'Release' : 'Disconnect'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <InstanceDoctorSheet
        instanceId={row.id}
        displayName={row.displayName}
        open={doctorOpen}
        onOpenChange={setDoctorOpen}
      />

      <TemplatesSheet instanceId={row.id} open={templatesOpen} onOpenChange={setTemplatesOpen} />

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
  if (props.row.channel === 'whatsapp') {
    return <WhatsAppRowMenu {...props} />
  }
  return <WebRowMenu {...props} />
}
