import { describe, expect, it } from 'bun:test'

import {
  computeVerifyState,
  normalizeAuthError,
  resolveVerifyArgs,
  TEMPLATE_UNAPPROVED_MESSAGE,
} from './phone-verify-engine'

describe('computeVerifyState', () => {
  it('does not nudge when there is no signed-in user', () => {
    expect(computeVerifyState(null)).toEqual({ hasNumber: false, isVerified: false, shouldNudge: false })
  })

  it('does not nudge a user with no number on file', () => {
    expect(computeVerifyState({ phoneNumber: null, phoneNumberVerified: null })).toEqual({
      hasNumber: false,
      isVerified: false,
      shouldNudge: false,
    })
  })

  it('treats an empty-string number as no number', () => {
    expect(computeVerifyState({ phoneNumber: '', phoneNumberVerified: false }).shouldNudge).toBe(false)
  })

  it('nudges a user whose number is set but unverified (false)', () => {
    expect(computeVerifyState({ phoneNumber: '+6589523447', phoneNumberVerified: false })).toEqual({
      hasNumber: true,
      isVerified: false,
      shouldNudge: true,
    })
  })

  it('nudges a user whose number is set but verification is null', () => {
    expect(computeVerifyState({ phoneNumber: '+6589523447', phoneNumberVerified: null }).shouldNudge).toBe(true)
  })

  it('does not nudge a user whose number is verified', () => {
    expect(computeVerifyState({ phoneNumber: '+6589523447', phoneNumberVerified: true })).toEqual({
      hasNumber: true,
      isVerified: true,
      shouldNudge: false,
    })
  })

  it('reports not-verified for the contradictory verified-but-no-number shape', () => {
    expect(computeVerifyState({ phoneNumber: '', phoneNumberVerified: true })).toEqual({
      hasNumber: false,
      isVerified: false,
      shouldNudge: false,
    })
  })
})

describe('resolveVerifyArgs', () => {
  it('sets updatePhoneNumber when the typed number differs from the saved one', () => {
    expect(resolveVerifyArgs({ typed: '+6580000000', saved: '+6589523447', code: '123456' })).toEqual({
      phoneNumber: '+6580000000',
      code: '123456',
      updatePhoneNumber: true,
    })
  })

  it('clears updatePhoneNumber when re-verifying the already-saved number (avoids self-collision)', () => {
    expect(resolveVerifyArgs({ typed: '+6589523447', saved: '+6589523447', code: '000000' })).toEqual({
      phoneNumber: '+6589523447',
      code: '000000',
      updatePhoneNumber: false,
    })
  })

  it('trims surrounding whitespace before comparing and submitting', () => {
    const args = resolveVerifyArgs({ typed: '  +6589523447  ', saved: '+6589523447', code: '654321' })
    expect(args.phoneNumber).toBe('+6589523447')
    expect(args.updatePhoneNumber).toBe(false)
  })

  it('trims the saved side too, and forwards the code verbatim (no leading-zero mangling)', () => {
    const args = resolveVerifyArgs({ typed: '+6589523447', saved: '  +6589523447  ', code: '000123' })
    expect(args.updatePhoneNumber).toBe(false)
    expect(args.code).toBe('000123')
  })
})

describe('normalizeAuthError', () => {
  it('returns no message when the result carries no error', () => {
    expect(normalizeAuthError(null, 'send')).toEqual({ message: null, isTemplateUnapproved: false })
    expect(normalizeAuthError({ error: null }, 'verify')).toEqual({ message: null, isTemplateUnapproved: false })
  })

  it('maps the unapproved-template code (either casing) to the setup message', () => {
    expect(normalizeAuthError({ error: { code: 'PHONE_OTP_TEMPLATE_UNAPPROVED' } }, 'send')).toEqual({
      message: TEMPLATE_UNAPPROVED_MESSAGE,
      isTemplateUnapproved: true,
    })
    expect(normalizeAuthError({ error: { code: 'phone_otp_template_unapproved' } }, 'send')).toEqual({
      message: TEMPLATE_UNAPPROVED_MESSAGE,
      isTemplateUnapproved: true,
    })
  })

  it('passes a server-provided error message through unchanged', () => {
    expect(normalizeAuthError({ error: { message: 'Phone number already exists' } }, 'verify')).toEqual({
      message: 'Phone number already exists',
      isTemplateUnapproved: false,
    })
  })

  it('falls back to a kind-specific message when the error has no message', () => {
    expect(normalizeAuthError({ error: { code: 'OTHER' } }, 'send')).toEqual({
      message: 'Could not send the code. Try again.',
      isTemplateUnapproved: false,
    })
    expect(normalizeAuthError({ error: { code: 'OTHER' } }, 'verify').message).toBe(
      'That code did not work. Try again.',
    )
  })

  it('lets the unapproved-template code win over a server-provided message', () => {
    expect(
      normalizeAuthError(
        { error: { code: 'PHONE_OTP_TEMPLATE_UNAPPROVED', message: 'Template not approved' } },
        'verify',
      ),
    ).toEqual({ message: TEMPLATE_UNAPPROVED_MESSAGE, isTemplateUnapproved: true })
  })

  it('maps the unapproved-template code independent of kind', () => {
    expect(normalizeAuthError({ error: { code: 'PHONE_OTP_TEMPLATE_UNAPPROVED' } }, 'verify')).toEqual({
      message: TEMPLATE_UNAPPROVED_MESSAGE,
      isTemplateUnapproved: true,
    })
  })
})
