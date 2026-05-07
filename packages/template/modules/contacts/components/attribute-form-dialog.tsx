/**
 * AttributeFormDialog — create/edit a single attribute definition.
 * Key is auto-generated from label in create mode and frozen after creation.
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
import type { AttributeSensitivity, AttributeType, ContactAttributeDefinition } from '../schema'

const TYPE_OPTIONS: { value: AttributeType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes / No' },
  { value: 'date', label: 'Date' },
  { value: 'enum', label: 'Choice list' },
]

const SENSITIVITY_OPTIONS: { value: AttributeSensitivity; label: string; description: string }[] = [
  { value: 'low', label: 'Low', description: 'Trivial info — agent can update freely.' },
  { value: 'medium', label: 'Medium', description: 'Default. Updates auto-apply when the agent is confident.' },
  { value: 'high', label: 'High', description: 'Updates usually wait for staff review.' },
  { value: 'critical', label: 'Critical', description: 'Always wait for staff review (e.g. medical, ID numbers).' },
]

export interface AttributeFormValues {
  key: string
  label: string
  type: AttributeType
  options: string[]
  showInTable: boolean
  sensitivity: AttributeSensitivity
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  attribute: ContactAttributeDefinition | null
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
  const [sensitivity, setSensitivity] = useState<AttributeSensitivity>('medium')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setKey(attribute?.key ?? '')
    setLabel(attribute?.label ?? '')
    setType(attribute?.type ?? 'text')
    setOptions(attribute?.options.join(', ') ?? '')
    setShowInTable(attribute?.showInTable ?? false)
    setSensitivity(attribute?.sensitivity ?? 'medium')
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
    onSave({
      key: trimmedKey,
      label: trimmedLabel,
      type,
      options: parsedOptions,
      showInTable,
      sensitivity,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit attribute' : 'New attribute'}</DialogTitle>
          <DialogDescription>
            Custom fields appear on every contact. Turn on "show in list" to surface a column in the contacts table.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="attr-label">Name</Label>
            <Input
              id="attr-label"
              value={label}
              onChange={(e) => handleLabelChange(e.target.value)}
              placeholder="Lead source"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="attr-key">Key</Label>
            <Input
              id="attr-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="lead_source"
              disabled={isEdit}
              className={isEdit ? 'opacity-60' : ''}
            />
            <p className="text-muted-foreground text-xs">
              {isEdit ? 'Key cannot be changed.' : 'Auto-filled from name. Used in exports and APIs.'}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="attr-type">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as AttributeType)}>
              <SelectTrigger id="attr-type">
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
              <Label htmlFor="attr-options">Choices</Label>
              <Input
                id="attr-options"
                value={options}
                onChange={(e) => setOptions(e.target.value)}
                placeholder="google, referral, ads"
              />
              <p className="text-muted-foreground text-xs">Separate choices with commas.</p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="attr-sensitivity">Sensitivity</Label>
            <Select value={sensitivity} onValueChange={(v) => setSensitivity(v as AttributeSensitivity)}>
              <SelectTrigger id="attr-sensitivity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SENSITIVITY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              {SENSITIVITY_OPTIONS.find((o) => o.value === sensitivity)?.description}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="attr-show"
              checked={showInTable}
              onCheckedChange={(checked) => setShowInTable(checked === true)}
            />
            <Label htmlFor="attr-show" className="cursor-pointer font-normal text-sm">
              Show as a column in the contacts list
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
