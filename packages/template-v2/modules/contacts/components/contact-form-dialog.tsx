/**
 * ContactFormDialog — create or edit a contact's basic identity fields.
 * Custom attributes are edited inline on the detail page.
 */

import { useEffect, useState } from 'react'

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
import { Switch } from '@/components/ui/switch'
import type { Contact } from '../schema'

export interface ContactFormValues {
  displayName: string
  email: string
  phone: string
  segments: string
  marketingOptOut: boolean
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  contact: Contact | null
  onSave: (values: ContactFormValues) => void
  isPending: boolean
}

export function ContactFormDialog({ open, onOpenChange, contact, onSave, isPending }: Props) {
  const isEdit = Boolean(contact)
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [segments, setSegments] = useState('')
  const [marketingOptOut, setMarketingOptOut] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setDisplayName(contact?.displayName ?? '')
    setEmail(contact?.email ?? '')
    setPhone(contact?.phone ?? '')
    setSegments(contact?.segments.join(', ') ?? '')
    setMarketingOptOut(contact?.marketingOptOut ?? false)
    setError(null)
  }, [open, contact])

  function submit() {
    setError(null)
    if (!displayName.trim() && !email.trim() && !phone.trim()) {
      setError('At least one of name, email, or phone is required.')
      return
    }
    onSave({
      displayName: displayName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      segments: segments.trim(),
      marketingOptOut,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit contact' : 'New contact'}</DialogTitle>
          <DialogDescription>
            Identity and marketing preferences. Custom attributes are edited on the contact page.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="contact-name">Name</Label>
            <Input
              id="contact-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Priya Raman"
              autoFocus
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="contact-email">Email</Label>
              <Input
                id="contact-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="priya@acme.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-phone">Phone</Label>
              <Input
                id="contact-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+65 9110 0201"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contact-segments">Segments</Label>
            <Input
              id="contact-segments"
              value={segments}
              onChange={(e) => setSegments(e.target.value)}
              placeholder="pro-plan, long-term"
            />
            <p className="text-xs text-muted-foreground">Comma separated. Used for filtering and campaigns.</p>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <div className="space-y-0.5">
              <Label htmlFor="contact-optout" className="text-sm font-normal">
                Marketing opt-out
              </Label>
              <p className="text-xs text-muted-foreground">Exclude from broadcasts and campaigns.</p>
            </div>
            <Switch id="contact-optout" checked={marketingOptOut} onCheckedChange={setMarketingOptOut} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create contact'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function normalizeContactForm(values: ContactFormValues): {
  displayName: string | null
  email: string | null
  phone: string | null
  segments: string[]
  marketingOptOut: boolean
} {
  return {
    displayName: values.displayName || null,
    email: values.email || null,
    phone: values.phone || null,
    segments: values.segments
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    marketingOptOut: values.marketingOptOut,
  }
}
