/**
 * StaffFormDialog — create (upsert) or edit a staff profile.
 *
 * Tag-like fields (sectors / expertise / languages) are entered as comma-
 * separated strings and split on save. Swap to DiceUI TagsInput when the
 * component lands in the template.
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { Availability, StaffProfile } from '../schema'

const AVAILABILITY_OPTIONS: { value: Availability; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'busy', label: 'Busy' },
  { value: 'off', label: 'Off' },
  { value: 'inactive', label: 'Inactive' },
]

export interface StaffFormValues {
  userId: string
  displayName: string
  title: string
  sectors: string[]
  expertise: string[]
  languages: string[]
  capacity: number
  availability: Availability
  profile: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Null → create mode (userId editable). Present → edit mode (userId frozen). */
  staff: StaffProfile | null
  onSave: (values: StaffFormValues) => void
  isPending: boolean
}

const toCsv = (xs: string[]) => xs.join(', ')
const fromCsv = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)

export function StaffFormDialog({ open, onOpenChange, staff, onSave, isPending }: Props) {
  const isEdit = Boolean(staff)
  const [userId, setUserId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [title, setTitle] = useState('')
  const [sectors, setSectors] = useState('')
  const [expertise, setExpertise] = useState('')
  const [languages, setLanguages] = useState('')
  const [capacity, setCapacity] = useState('10')
  const [availability, setAvailability] = useState<Availability>('active')
  const [profile, setProfile] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setUserId(staff?.userId ?? '')
    setDisplayName(staff?.displayName ?? '')
    setTitle(staff?.title ?? '')
    setSectors(toCsv(staff?.sectors ?? []))
    setExpertise(toCsv(staff?.expertise ?? []))
    setLanguages(toCsv(staff?.languages ?? []))
    setCapacity(String(staff?.capacity ?? 10))
    setAvailability(staff?.availability ?? 'active')
    setProfile(staff?.profile ?? '')
    setError(null)
  }, [open, staff])

  function submit() {
    setError(null)
    if (!isEdit && !userId.trim()) {
      setError('User ID is required (must match a better-auth user in this organization).')
      return
    }
    const cap = Number(capacity)
    if (Number.isNaN(cap) || cap < 0 || cap > 1000) {
      setError('Capacity must be a number between 0 and 1000.')
      return
    }
    onSave({
      userId: userId.trim(),
      displayName: displayName.trim(),
      title: title.trim(),
      sectors: fromCsv(sectors),
      expertise: fromCsv(expertise),
      languages: fromCsv(languages),
      capacity: cap,
      availability,
      profile,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit staff profile' : 'Add staff'}</DialogTitle>
          <DialogDescription>
            Domain profile for routing and operations. Identity + auth live in the organization members table.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="staff-user-id">User ID</Label>
            <Input
              id="staff-user-id"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="alice-user-id"
              disabled={isEdit}
              className={isEdit ? 'opacity-60' : ''}
            />
            <p className="text-xs text-muted-foreground">
              {isEdit ? 'User ID is immutable.' : 'Must match an existing organization member.'}
            </p>
          </div>
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
            <p className="text-xs text-muted-foreground">Separate with commas.</p>
          </div>
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
          <div className="space-y-1.5">
            <Label htmlFor="staff-profile">Profile</Label>
            <Textarea
              id="staff-profile"
              rows={4}
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              placeholder="Narrative routing hints, language preferences, OOO schedule…"
            />
            <p className="text-xs text-muted-foreground">
              Human-authored. Surfaced as <code>/PROFILE.md</code> in this staff member's Drive.
            </p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Add staff'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
