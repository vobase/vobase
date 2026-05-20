/**
 * StaffFormDialog — edit a staff profile's identity fields.
 *
 * Profile narrative is edited via `/PROFILE.md` in the staff member's Drive,
 * so it isn't part of this dialog. Custom attributes are edited inline on the
 * detail page.
 */

import { E164_RE } from '@auth/e164'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { PhoneNumberInput } from '@/components/phone-number-input'
import { PhoneVerificationBadge } from '@/components/phone-verification-badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { authClient, refreshSession } from '@/lib/auth-client'
import { staffKeys } from '../hooks/use-staff'
import type { Availability, StaffProfile } from '../schema'

const OTP_LENGTH = 6

/** Pull a human-readable error string out of a better-auth client result. */
function readAuthError(res: unknown): string | null {
  if (res && typeof res === 'object' && 'error' in res) {
    const err = (res as { error?: unknown }).error
    if (
      err &&
      typeof err === 'object' &&
      'message' in err &&
      typeof (err as { message?: unknown }).message === 'string'
    ) {
      return (err as { message: string }).message
    }
    if (err) return 'Something went wrong. Try again.'
  }
  return null
}

/**
 * Inline WhatsApp-OTP verification, shown only when a staff member edits their
 * OWN profile. better-auth's `phoneNumber.sendOtp` / `verify` act on the
 * current session, so this can only verify the signed-in user's number —
 * editing a different staff member's number falls back to the server-side
 * OTP relay fired by `team/service/staff.ts::writePhoneNumber`.
 *
 * A successful `verify` moves the new number onto the user row with
 * `phoneNumberVerified = true`, so the subsequent staff PATCH sees an
 * unchanged phone and skips its own reset + re-send.
 */
function WhatsAppVerifyInline({
  phoneNumber,
  savedPhone,
  onVerified,
}: {
  phoneNumber: string
  savedPhone: string
  onVerified: () => void
}) {
  const qc = useQueryClient()
  const [step, setStep] = useState<'idle' | 'code'>('idle')
  const [error, setError] = useState<string | null>(null)

  const sendOtp = useMutation({
    mutationFn: (pn: string) => authClient.phoneNumber.sendOtp({ phoneNumber: pn }),
  })
  const verifyOtp = useMutation({
    mutationFn: (vars: { phoneNumber: string; code: string; updatePhoneNumber: boolean }) =>
      authClient.phoneNumber.verify(vars),
  })

  function handleSend() {
    setError(null)
    sendOtp.mutate(phoneNumber, {
      onSuccess: (res) => {
        const message = readAuthError(res)
        if (message) {
          sendOtp.reset()
          setError(message)
          return
        }
        setStep('code')
      },
    })
  }

  function handleVerify(code: string) {
    setError(null)
    verifyOtp.mutate(
      // `updatePhoneNumber: true` makes better-auth attach the number to the
      // signed-in user's row (via session id) and mark it verified. The plain
      // path looks a user up BY the number and fails with FAILED_TO_UPDATE_USER
      // when no row carries it yet. Only skip it when the number is already the
      // saved one — re-verifying it then would self-collide on PHONE_NUMBER_EXIST.
      { phoneNumber, code, updatePhoneNumber: phoneNumber !== savedPhone },
      {
        onSuccess: async (res) => {
          const message = readAuthError(res)
          if (message) {
            verifyOtp.reset()
            setError(message)
            return
          }
          // Refresh the session store so `useSession()` readers (settings page)
          // pick up the verified number instead of the stale cookie cache.
          await refreshSession()
          qc.invalidateQueries({ queryKey: staffKeys.all })
          onVerified()
        },
      },
    )
  }

  if (step === 'idle') {
    return (
      <div className="space-y-1.5">
        <Button type="button" size="sm" variant="outline" onClick={handleSend} disabled={sendOtp.isPending}>
          {sendOtp.isPending ? 'Sending…' : 'Send verification code'}
        </Button>
        <p className="text-muted-foreground text-xs">
          Verify this number now to receive mention-ping notifications on WhatsApp.
        </p>
        {error && <p className="text-destructive text-xs">{error}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-xs">
        Enter the 6-digit code sent to <span className="font-medium text-foreground">{phoneNumber}</span> on WhatsApp.
      </p>
      <InputOTP maxLength={OTP_LENGTH} onComplete={handleVerify} disabled={verifyOtp.isPending}>
        <InputOTPGroup>
          {Array.from({ length: OTP_LENGTH }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: OTP slots are stable by position
            <InputOTPSlot key={i} index={i} />
          ))}
        </InputOTPGroup>
      </InputOTP>
      {error && <p className="text-destructive text-xs">{error}</p>}
      <button
        type="button"
        className="text-muted-foreground text-xs underline-offset-4 hover:underline disabled:opacity-50"
        disabled={sendOtp.isPending}
        onClick={handleSend}
      >
        Resend code
      </button>
    </div>
  )
}

const AVAILABILITY_OPTIONS: { value: Availability; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'busy', label: 'Busy' },
  { value: 'off', label: 'Off' },
  { value: 'inactive', label: 'Inactive' },
]

export interface StaffFormValues {
  displayName: string
  title: string
  sectors: string[]
  expertise: string[]
  languages: string[]
  capacity: number
  availability: Availability
  /** E.164 with leading `+`, or null to clear. Stored on the better-auth user; used for WhatsApp mention pings. */
  phoneNumber: string | null
  /**
   * Org membership role to apply on save, or `null` when the editor can't
   * manage roles. Lives in better-auth org membership, NOT `staff_profiles` —
   * the parent commits it via `updateMemberRole`.
   */
  role: 'admin' | 'member' | null
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  staff: StaffProfile
  onSave: (values: StaffFormValues) => void
  isPending: boolean
  /**
   * True when the signed-in user is editing their OWN profile. Gates the
   * inline WhatsApp-OTP verification — better-auth can only verify the
   * current session's number, so other-staff edits fall back to the
   * server-side OTP relay.
   */
  isSelf: boolean
  /** True when the editor (owner/admin) may change this member's org role. */
  canEditRole: boolean
  /** This member's current org role, used to seed the role selector. */
  memberRole: string | null
}

const toCsv = (xs: string[]) => xs.join(', ')
const fromCsv = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)

export function StaffFormDialog({
  open,
  onOpenChange,
  staff,
  onSave,
  isPending,
  isSelf,
  canEditRole,
  memberRole,
}: Props) {
  const [displayName, setDisplayName] = useState('')
  const [title, setTitle] = useState('')
  const [sectors, setSectors] = useState('')
  const [expertise, setExpertise] = useState('')
  const [languages, setLanguages] = useState('')
  const [capacity, setCapacity] = useState('10')
  const [availability, setAvailability] = useState<Availability>('active')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [error, setError] = useState<string | null>(null)
  /** Number confirmed via the inline OTP flow this dialog session. */
  const [verifiedPhone, setVerifiedPhone] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setDisplayName(staff.displayName ?? '')
    setTitle(staff.title ?? '')
    setSectors(toCsv(staff.sectors))
    setExpertise(toCsv(staff.expertise))
    setLanguages(toCsv(staff.languages))
    setCapacity(String(staff.capacity))
    setAvailability(staff.availability)
    setPhone(staff.phoneNumber ?? '')
    setRole(memberRole === 'admin' ? 'admin' : 'member')
    setError(null)
    setVerifiedPhone(null)
  }, [open, staff, memberRole])

  const phoneTrimmed = phone.trim()
  const savedPhone = staff.phoneNumber ?? ''
  const phoneValid = E164_RE.test(phoneTrimmed)
  const isVerified =
    phoneTrimmed !== '' &&
    ((phoneTrimmed === savedPhone && staff.phoneNumberVerified === true) || phoneTrimmed === verifiedPhone)
  const showBadge = phoneTrimmed !== '' && (phoneTrimmed === savedPhone || phoneTrimmed === verifiedPhone)
  const canVerifyInline = isSelf && phoneValid && !isVerified

  function submit() {
    setError(null)
    const cap = Number(capacity)
    if (Number.isNaN(cap) || cap < 0 || cap > 1000) {
      setError('Capacity must be between 0 and 1000.')
      return
    }
    const phoneRaw = phone.trim()
    // Empty → null (clear). Otherwise must match E.164 with leading `+`.
    const phoneValue: string | null = phoneRaw === '' ? null : phoneRaw
    if (phoneValue !== null && !E164_RE.test(phoneValue)) {
      setError('WhatsApp number must be E.164 with leading + (e.g. +6591234567).')
      return
    }
    onSave({
      displayName: displayName.trim(),
      title: title.trim(),
      sectors: fromCsv(sectors),
      expertise: fromCsv(expertise),
      languages: fromCsv(languages),
      capacity: cap,
      availability,
      phoneNumber: phoneValue,
      role: canEditRole ? role : null,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit staff profile</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="staff-display-name">Display name</Label>
              <Input
                id="staff-display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Alice Tan"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff-title">Title</Label>
              <Input
                id="staff-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Customer Success"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="staff-sectors">Sectors</Label>
            <Input
              id="staff-sectors"
              value={sectors}
              onChange={(e) => setSectors(e.target.value)}
              placeholder="retail, f&b"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="staff-expertise">Expertise</Label>
            <Input
              id="staff-expertise"
              value={expertise}
              onChange={(e) => setExpertise(e.target.value)}
              placeholder="customer-support, onboarding"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="staff-languages">Languages</Label>
            <Input
              id="staff-languages"
              value={languages}
              onChange={(e) => setLanguages(e.target.value)}
              placeholder="en, zh"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="staff-whatsapp-phone">WhatsApp number</Label>
              {showBadge && <PhoneVerificationBadge verified={isVerified} />}
            </div>
            <PhoneNumberInput
              id="staff-whatsapp-phone"
              value={phone}
              onChange={setPhone}
              helperText={
                canVerifyInline
                  ? undefined
                  : phone && phone !== savedPhone
                    ? 'Saving will require the staff member to re-verify via a WhatsApp one-time code on next sign-in.'
                    : 'Required to receive mention-ping notifications via WhatsApp.'
              }
            />
            {canVerifyInline && (
              <WhatsAppVerifyInline
                key={phoneTrimmed}
                phoneNumber={phoneTrimmed}
                savedPhone={savedPhone}
                onVerified={() => setVerifiedPhone(phoneTrimmed)}
              />
            )}
          </div>
          {canEditRole && (
            <div className="space-y-1.5">
              <Label htmlFor="staff-role">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as 'admin' | 'member')}>
                <SelectTrigger id="staff-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">Admins can invite members and manage the organization.</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="staff-capacity">Capacity</Label>
              <Input
                id="staff-capacity"
                type="number"
                min={0}
                max={1000}
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff-availability">Availability</Label>
              <Select value={availability} onValueChange={(v) => setAvailability(v as Availability)}>
                <SelectTrigger id="staff-availability">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AVAILABILITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
