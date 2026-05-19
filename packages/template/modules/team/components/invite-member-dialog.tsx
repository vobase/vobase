/**
 * InviteMemberDialog — invites a user to the active organization via
 * Better Auth's `organization.inviteMember`. Role defaults to `member`; owner
 * or admin can also invite as `admin`. A `staff_profiles` row is auto-created
 * when the invitee signs in and their membership is minted (see
 * `server/auth/index.ts` auto-enroll hooks).
 */

import { E164_RE } from '@auth/e164'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'

import { PhoneNumberInput } from '@/components/phone-number-input'
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
import { invitationsKeys } from '../hooks/use-invitations'
import { teamsKeys } from '../hooks/use-teams'

const inviteSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  role: z.enum(['admin', 'member']),
  // Optional staff phone — rides the invitation row and is copied onto the
  // user at sign-in (see `auth/index.ts` autoEnroll). `null` when left blank.
  phoneNumber: z.string().regex(E164_RE, 'Phone must be E.164 with leading + (e.g. +6591234567)').nullable(),
})

export function InviteMemberDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [phone, setPhone] = useState('')

  const invite = useMutation({
    mutationFn: async (input: { email: string; role: 'admin' | 'member'; phoneNumber: string | null }) => {
      // biome-ignore lint/suspicious/noExplicitAny: better-auth runtime types are loose
      const result = await (authClient.organization as any).inviteMember({
        email: input.email,
        role: input.role,
        resend: true,
        ...(input.phoneNumber ? { phoneNumber: input.phoneNumber } : {}),
      })
      if (result.error) throw new Error(result.error.message ?? 'inviteMember failed')
      return result.data
    },
    onSuccess: () => {
      toast.success('Invitation sent')
      qc.invalidateQueries({ queryKey: teamsKeys.orgMembers })
      qc.invalidateQueries({ queryKey: ['staff'] })
      qc.invalidateQueries({ queryKey: invitationsKeys.list })
      setEmail('')
      setRole('member')
      setPhone('')
      onOpenChange(false)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = inviteSchema.safeParse({ email, role, phoneNumber: phone.trim() || null })
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-phone">WhatsApp number (optional)</Label>
            <PhoneNumberInput
              id="invite-phone"
              value={phone}
              onChange={setPhone}
              helperText="The invitee will verify this number via a WhatsApp one-time code on first sign-in. Editable later on the staff profile."
            />
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
