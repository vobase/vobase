/**
 * PendingInvitationsCard — renders the pending org invitations as a compact
 * table above the staff roster on `/team`. Admin actions: resend (re-deliver
 * the same invite email + bump TTL) and revoke (flip `auth.invitation.status`
 * to `canceled`).
 *
 * The roster page renders us unconditionally; the empty state below shows when
 * there are no pending invites so admins know the feature exists.
 */

import { Mail, RotateCw, X } from 'lucide-react'
import { useState } from 'react'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { RelativeTimeCard } from '@/components/ui/relative-time-card'
import {
  type PendingInvitationRow,
  usePendingInvitations,
  useResendInvitation,
  useRevokeInvitation,
} from '../hooks/use-invitations'

function ResendButton({ row, canManage }: { row: PendingInvitationRow; canManage: boolean }) {
  const resend = useResendInvitation()
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={!canManage || resend.isPending}
      onClick={() => {
        resend.mutate(row.id, {
          onSuccess: () => toast.success(`Re-sent invitation to ${row.email}`),
          onError: (err) => toast.error(err.message),
        })
      }}
    >
      <RotateCw />
      Resend
    </Button>
  )
}

function RevokeButton({ row, canManage }: { row: PendingInvitationRow; canManage: boolean }) {
  const [open, setOpen] = useState(false)
  const revoke = useRevokeInvitation()
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={!canManage || revoke.isPending}
        onClick={() => setOpen(true)}
        className="text-destructive hover:text-destructive"
      >
        <X />
        Revoke
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke invitation?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{row.email}</strong> will no longer be able to accept this invitation. You can re-invite them
              later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                revoke.mutate(row.id, {
                  onSuccess: () => {
                    toast.success(`Revoked invitation for ${row.email}`)
                    setOpen(false)
                  },
                  onError: (err) => toast.error(err.message),
                })
              }}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function PendingInvitationsCard({ canManage }: { canManage: boolean }) {
  const { data: rows = [], isLoading, error } = usePendingInvitations()

  if (error) {
    return (
      <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-destructive text-sm">
        Failed to load pending invitations
      </div>
    )
  }

  if (isLoading) return null

  if (rows.length === 0) {
    return (
      <Empty className="mb-4 border border-dashed py-6">
        <EmptyHeader>
          <EmptyMedia>
            <Mail />
          </EmptyMedia>
          <EmptyTitle>No pending invitations</EmptyTitle>
          <EmptyDescription>Invited members appear here until they accept and sign in.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="mb-6 overflow-hidden rounded-md border">
      <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
        <h2 className="font-medium text-sm">Pending invitations</h2>
        <Badge variant="secondary" className="font-normal">
          {rows.length}
        </Badge>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground text-xs">
            <th className="px-3 py-2 font-medium">Email</th>
            <th className="px-3 py-2 font-medium">Role</th>
            <th className="px-3 py-2 font-medium">Invited by</th>
            <th className="px-3 py-2 font-medium">Expires</th>
            <th className="px-3 py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b last:border-b-0">
              <td className="px-3 py-2 font-medium">{row.email}</td>
              <td className="px-3 py-2 text-muted-foreground">{row.role ?? '—'}</td>
              <td className="px-3 py-2 text-muted-foreground">{row.inviterName ?? row.inviterEmail ?? '—'}</td>
              <td className="px-3 py-2 text-muted-foreground">
                <RelativeTimeCard date={row.expiresAt} />
              </td>
              <td className="px-3 py-2 text-right">
                <div className="flex justify-end gap-1">
                  <ResendButton row={row} canManage={canManage} />
                  <RevokeButton row={row} canManage={canManage} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
