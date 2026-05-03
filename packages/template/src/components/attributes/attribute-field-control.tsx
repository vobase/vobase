import { Check, Minus, X } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

export type AttributeType = 'text' | 'number' | 'boolean' | 'date' | 'enum'
export type AttributeValue = string | number | boolean | null

export interface AttributeDefinitionLike {
  key: string
  label: string
  type: AttributeType
  options: string[]
}

interface ControlProps {
  def: AttributeDefinitionLike
  value: AttributeValue | undefined
  onChange: (value: AttributeValue | null) => void
  disabled?: boolean
  idPrefix: string
}

export function AttributeFieldControl({ def, value, onChange, disabled, idPrefix }: ControlProps) {
  const id = `${idPrefix}-${def.key}`
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
