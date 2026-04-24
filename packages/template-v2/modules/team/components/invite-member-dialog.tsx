/**
 * InviteMemberDialog — invites a user to the active organization via
 * Better Auth's `organization.inviteMember`. Role defaults to `member`; owner
 * or admin can also invite as `admin`. A `staff_profiles` row is auto-created
 * when the invitee signs in and their membership is minted (see
 * `server/auth/index.ts` auto-enroll hooks).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { authClient } from '@/lib/auth-client'
import { teamsKeys } from '../api/use-teams'

const inviteSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  role: z.enum(['admin', 'member']),
})

export function InviteMemberDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')

  const invite = useMutation({
    mutationFn: async (input: { email: string; role: 'admin' | 'member' }) => {
      // biome-ignore lint/suspicious/noExplicitAny: better-auth runtime types are loose
      const result = await (authClient.organization as any).inviteMember({
        email: input.email,
        role: input.role,
        resend: true,
      })
      if (result.error) throw new Error(result.error.message ?? 'inviteMember failed')
      return result.data
    },
    onSuccess: () => {
      toast.success('Invitation sent')
      qc.invalidateQueries({ queryKey: teamsKeys.orgMembers })
      qc.invalidateQueries({ queryKey: ['staff'] })
      setEmail('')
      setRole('member')
      onOpenChange(false)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = inviteSchema.safeParse({ email, role })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message)
      return
    }
    invite.mutate(parsed.data)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite member</DialogTitle>
          <DialogDescription>
            They'll receive an email with a sign-in link. A staff profile is created when they accept.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as 'admin' | 'member')}>
              <SelectTrigger id="invite-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={invite.isPending}>
              {invite.isPending ? 'Sending…' : 'Send invitation'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
