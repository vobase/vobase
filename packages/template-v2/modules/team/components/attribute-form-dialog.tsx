/**
 * AttributeFormDialog — create/edit a single staff attribute definition.
 * Clone of contacts/components/attribute-form-dialog.tsx.
 */

import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import type { AttributeType, StaffAttributeDefinition } from '../schema'

const TYPE_OPTIONS: { value: AttributeType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes / No' },
  { value: 'date', label: 'Date' },
  { value: 'enum', label: 'Choice list' },
]

export interface AttributeFormValues {
  key: string
  label: string
  type: AttributeType
  options: string[]
  showInTable: boolean
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  attribute: StaffAttributeDefinition | null
  onSave: (values: AttributeFormValues) => void
  isPending: boolean
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

export function AttributeFormDialog({ open, onOpenChange, attribute, onSave, isPending }: Props) {
  const isEdit = Boolean(attribute)
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [type, setType] = useState<AttributeType>('text')
  const [options, setOptions] = useState('')
  const [showInTable, setShowInTable] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setKey(attribute?.key ?? '')
    setLabel(attribute?.label ?? '')
    setType(attribute?.type ?? 'text')
    setOptions(attribute?.options.join(', ') ?? '')
    setShowInTable(attribute?.showInTable ?? false)
    setError(null)
  }, [open, attribute])

  function handleLabelChange(value: string) {
    setLabel(value)
    if (!isEdit) setKey(slugify(value))
  }

  function submit() {
    setError(null)
    const trimmedLabel = label.trim()
    const trimmedKey = key.trim()
    if (!trimmedLabel || !trimmedKey) {
      setError('Name and key are required.')
      return
    }
    const parsedOptions =
      type === 'enum'
        ? options
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : []
    if (type === 'enum' && parsedOptions.length === 0) {
      setError('Add at least one choice, separated by commas.')
      return
    }
    onSave({ key: trimmedKey, label: trimmedLabel, type, options: parsedOptions, showInTable })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit attribute' : 'New attribute'}</DialogTitle>
          <DialogDescription>
            Custom fields appear on every staff member. Turn on "show in list" to surface a column in the staff table.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="staff-attr-label">Name</Label>
            <Input
              id="staff-attr-label"
              value={label}
              onChange={(e) => handleLabelChange(e.target.value)}
              placeholder="Department"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="staff-attr-key">Key</Label>
            <Input
              id="staff-attr-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="department"
              disabled={isEdit}
              className={isEdit ? 'opacity-60' : ''}
            />
            <p className="text-muted-foreground text-xs">
              {isEdit ? 'Key cannot be changed.' : 'Auto-filled from name. Used in exports and APIs.'}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="staff-attr-type">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as AttributeType)}>
              <SelectTrigger id="staff-attr-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {type === 'enum' && (
            <div className="space-y-1.5">
              <Label htmlFor="staff-attr-options">Choices</Label>
              <Input
                id="staff-attr-options"
                value={options}
                onChange={(e) => setOptions(e.target.value)}
                placeholder="engineering, support, billing"
              />
              <p className="text-muted-foreground text-xs">Separate choices with commas.</p>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Checkbox
              id="staff-attr-show"
              checked={showInTable}
              onCheckedChange={(checked) => setShowInTable(checked === true)}
            />
            <Label htmlFor="staff-attr-show" className="cursor-pointer font-normal text-sm">
              Show as a column in the staff list
            </Label>
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create attribute'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
