/**
 * AttributeFormField — renders an input for a single staff attribute
 * definition. Clone of contacts/components/attribute-form-field.tsx, rebound
 * to the team schema.
 */

import { Check, Minus, X } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { AttributeType, AttributeValue, StaffAttributeDefinition } from '../schema'

interface Props {
  def: StaffAttributeDefinition
  value: AttributeValue | undefined
  onChange: (value: AttributeValue | null) => void
  disabled?: boolean
}

export function AttributeFormField({ def, value, onChange, disabled }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`staff-attr-${def.key}`} className="font-medium text-muted-foreground text-xs">
        {def.label}
      </Label>
      <FieldInput def={def} value={value} onChange={onChange} disabled={disabled} />
    </div>
  )
}

function FieldInput({ def, value, onChange, disabled }: Props) {
  const id = `staff-attr-${def.key}`
  switch (def.type satisfies AttributeType) {
    case 'text':
      return (
        <Input
          id={id}
          disabled={disabled}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
      )
    case 'number':
      return (
        <Input
          id={id}
          type="number"
          disabled={disabled}
          value={typeof value === 'number' ? String(value) : ''}
          onChange={(e) => {
            const v = e.target.value
            if (v === '') return onChange(null)
            const n = Number(v)
            if (!Number.isNaN(n)) onChange(n)
          }}
        />
      )
    case 'boolean': {
      const state: 'yes' | 'no' | 'unset' = value === true ? 'yes' : value === false ? 'no' : 'unset'
      return (
        <div className="flex h-9 items-center justify-between rounded-md border border-input bg-transparent px-3 text-sm">
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            {state === 'yes' && (
              <>
                <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                Yes
              </>
            )}
            {state === 'no' && (
              <>
                <X className="size-3.5" />
                No
              </>
            )}
            {state === 'unset' && (
              <>
                <Minus className="size-3.5" />
                Not set
              </>
            )}
          </span>
          <Switch
            id={id}
            disabled={disabled}
            checked={value === true}
            onCheckedChange={(checked) => onChange(checked)}
          />
        </div>
      )
    }
    case 'date':
      return (
        <Input
          id={id}
          type="date"
          disabled={disabled}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
      )
    case 'enum':
      return (
        <Select
          disabled={disabled}
          value={typeof value === 'string' ? value : ''}
          onValueChange={(v) => onChange(v === '' ? null : v)}
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {def.options.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
  }
}
