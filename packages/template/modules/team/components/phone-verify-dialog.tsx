/**
 * PhoneVerifyDialog — focused, self-contained dialog for verifying the
 * signed-in user's OWN WhatsApp number. The saved number is pre-filled and
 * editable, so a typo can be corrected in place before sending the code.
 * Opened from the top-right nudge and the Team-list self row via
 * `useDialogs().openPhoneVerify()`.
 */

import { useEffect, useState } from 'react'

import { PhoneNumberInput } from '@/components/phone-number-input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { useSessionUser } from '@/hooks/use-session-user'
import { PhoneVerifyControls } from './phone-verify-controls'

interface PhoneVerifyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PhoneVerifyDialog({ open, onOpenChange }: PhoneVerifyDialogProps) {
  const user = useSessionUser()
  const savedPhone = user?.phoneNumber ?? ''
  const [phone, setPhone] = useState('')

  // Pre-fill with the saved number each time the dialog opens.
  useEffect(() => {
    if (open) setPhone(savedPhone)
  }, [open, savedPhone])

  const trimmed = phone.trim()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Verify your WhatsApp number</DialogTitle>
          <DialogDescription>We will send a 6-digit code to this number on WhatsApp.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="phone-verify-number">WhatsApp number</Label>
            <PhoneNumberInput id="phone-verify-number" value={phone} onChange={setPhone} autoFocus />
          </div>
          <PhoneVerifyControls
            key={trimmed}
            phone={trimmed}
            savedPhone={savedPhone}
            onVerified={() => onOpenChange(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
