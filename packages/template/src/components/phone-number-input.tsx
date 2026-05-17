/**
 * PhoneNumberInput — shared E.164 phone input used across all four call sites:
 * verify-phone, staff-form-dialog, invite-member-dialog, contact-form-dialog.
 *
 * Validates on blur against E164_RE. Strips spaces/dashes/parens on blur but
 * keeps the leading `+`. Surfaces an inline error message when the value is
 * non-empty and invalid (or required and empty).
 */

import { E164_RE } from '@auth/e164'
import { useId, useRef, useState } from 'react'

import { Input } from '@/components/ui/input'

const DEFAULT_PLACEHOLDER = '+6591234567'
const DEFAULT_INVALID_MSG = 'Enter your phone in international format, e.g. +6591234567'

/** Strip spaces, dashes, and parentheses while keeping the leading `+`. */
function normalize(raw: string): string {
  return raw.replace(/[\s\-()]/g, '')
}

export interface PhoneNumberInputProps {
  value: string
  onChange: (e164: string) => void
  /** When true the field is allowed to be empty; validation only fires if the user types something. */
  optional?: boolean
  placeholder?: string
  id?: string
  disabled?: boolean
  autoFocus?: boolean
  'aria-describedby'?: string
  /** Additional helper text shown below the input (always, not just on error). */
  helperText?: string
  /** Override the default "invalid format" error message. */
  errorText?: string
}

export function PhoneNumberInput({
  value,
  onChange,
  optional = false,
  placeholder = DEFAULT_PLACEHOLDER,
  id,
  disabled,
  autoFocus,
  'aria-describedby': ariaDescribedby,
  helperText,
  errorText,
}: PhoneNumberInputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const helperId = `${inputId}-helper`

  const [invalid, setInvalid] = useState(false)
  // Track whether the user has ever left the field so we don't show errors
  // before they've had a chance to type.
  const touched = useRef(false)

  function handleBlur() {
    touched.current = true
    const normalized = normalize(value)
    if (normalized !== value) onChange(normalized)
    const toCheck = normalized !== value ? normalized : value
    if (toCheck === '') {
      setInvalid(!optional)
    } else {
      setInvalid(!E164_RE.test(toCheck))
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value
    onChange(next)
    // Clear the error live once the value becomes valid (improves UX).
    if (invalid && (next === '' ? optional : E164_RE.test(normalize(next)))) {
      setInvalid(false)
    }
  }

  const describedBy =
    [ariaDescribedby, helperText || invalid ? helperId : undefined].filter(Boolean).join(' ') || undefined

  return (
    <div className="space-y-1">
      <Input
        id={inputId}
        type="tel"
        inputMode="tel"
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={invalid ? 'border-destructive focus-visible:ring-destructive' : undefined}
      />
      {(helperText || invalid) && (
        <p id={helperId} className={invalid ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'}>
          {invalid ? (errorText ?? DEFAULT_INVALID_MSG) : helperText}
        </p>
      )}
    </div>
  )
}
