/**
 * PhoneNumberInput — shared E.164 phone input used by verify-phone, login
 * (WhatsApp tab), staff-form-dialog, invite-member-dialog, and
 * contact-form-dialog. Wraps the DiceUI `<PhoneInput>` compound component with
 * Singapore as the default country. Emits E.164 (`+65…`) via `onChange`; the
 * underlying DiceUI store normalises to `+<digits>` so we never strip
 * formatting characters here. Validates against `E164_RE` on blur (only when
 * non-empty — required-but-empty is caught at submit by the form's Zod
 * schema) and surfaces an inline error message.
 */

import { E164_RE } from '@auth/e164'
import { useId, useState } from 'react'

import { PhoneInput, PhoneInputCountrySelect, PhoneInputField } from '@/components/ui/phone-input'

const DEFAULT_PLACEHOLDER = '9123 4567'
const DEFAULT_INVALID_MSG = 'Enter a valid phone number, e.g. +65 9123 4567'
const DEFAULT_COUNTRY = 'SG'

export interface PhoneNumberInputProps {
  value: string
  onChange: (e164: string) => void
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

  // Show the format error on blur only when the user has typed something.
  // Empty-but-required is left to the form's submit-time validation so the user
  // doesn't see an angry red field just for hovering past the input.
  function handleBlur() {
    if (value === '' || value === '+') {
      setInvalid(false)
      return
    }
    setInvalid(!E164_RE.test(value))
  }

  function handleChange(next: string) {
    onChange(next)
    if (invalid && (next === '' || E164_RE.test(next))) {
      setInvalid(false)
    }
  }

  const describedBy =
    [ariaDescribedby, helperText || invalid ? helperId : undefined].filter(Boolean).join(' ') || undefined

  return (
    <div className="space-y-1">
      <PhoneInput
        value={value}
        onValueChange={handleChange}
        defaultCountry={DEFAULT_COUNTRY}
        disabled={disabled}
        invalid={invalid}
      >
        <PhoneInputCountrySelect />
        <PhoneInputField
          id={inputId}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onBlur={handleBlur}
          aria-describedby={describedBy}
        />
      </PhoneInput>
      {(helperText || invalid) && (
        <p id={helperId} className={invalid ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'}>
          {invalid ? (errorText ?? DEFAULT_INVALID_MSG) : helperText}
        </p>
      )}
    </div>
  )
}
