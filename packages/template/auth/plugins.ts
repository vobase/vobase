/**
 * Single source of truth for the schema-contributing better-auth plugins.
 *
 * Both the runtime config (`createAuth` in `./index.ts`) and the
 * CLI-introspection config (`./auth.config.ts`, consumed by `bun run gen:auth`)
 * build their plugin list from here, so the generated `./schema.ts` can never
 * drift from what the runtime expects.
 *
 * Env-gated plugins that contribute no tables (`platformAuth`, `devAuth`) are
 * appended separately in `createAuth` — they don't belong here because they
 * have no bearing on the schema.
 */

import { apiKey } from '@better-auth/api-key'
import { APIError } from 'better-auth/api'
import { anonymous } from 'better-auth/plugins/anonymous'
import { bearer } from 'better-auth/plugins/bearer'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { organization } from 'better-auth/plugins/organization'
import { phoneNumber } from 'better-auth/plugins/phone-number'

import { ac, roles } from './ac'
import { E164_RE } from './e164'

/** Bearer-token shape the vobase CLI sends: `Authorization: Bearer vbt_<key>`. */
const BEARER_API_KEY_RE = /^Bearer\s+(vbt_[A-Za-z0-9_-]+)$/u

type EmailOtpOptions = NonNullable<Parameters<typeof emailOTP>[0]>
type OrganizationOptions = NonNullable<Parameters<typeof organization>[0]>

export interface AuthPluginOpts {
  /** Whether users may create their own organizations (`VOBASE_MULTI_ORG`). */
  multiOrg: boolean
  sendVerificationOTP: EmailOtpOptions['sendVerificationOTP']
  sendInvitationEmail: OrganizationOptions['sendInvitationEmail']
  /** Serial name for a fresh anonymous session, e.g. "Visitor B001". */
  generateAnonymousName: () => Promise<string>
}

export function buildAuthPlugins(opts: AuthPluginOpts) {
  return [
    // Bearer tokens let the public /chat page authenticate via
    // `Authorization: Bearer <token>` instead of cookies. That isolates the
    // widget's anonymous session from the dashboard cookie session on the
    // same origin.
    bearer(),
    anonymous({
      // Public /chat visitors get a serial name ("Visitor B001") instead of
      // better-auth's random id, so staff see a stable handle in the inbox.
      generateName: opts.generateAnonymousName,
    }),
    emailOTP({
      sendVerificationOTP: opts.sendVerificationOTP,
      otpLength: 6,
      expiresIn: 300,
    }),
    phoneNumber({
      // Storage-only: the plugin contributes `user.phoneNumber` /
      // `phoneNumberVerified`, which is where staff WhatsApp numbers now live
      // (admin-set at invite time, see `auth/index.ts`). Phone-based sign-in
      // is not enabled — `sendOTP` is the seam where a future SMS/WhatsApp
      // OTP sender plugs in. Until then the sign-in endpoints fail loudly.
      sendOTP: () => {
        throw new APIError('NOT_IMPLEMENTED', {
          message: 'Phone sign-in is not enabled on this deployment.',
        })
      },
      phoneNumberValidator: (value) => E164_RE.test(value),
    }),
    organization({
      allowUserToCreateOrganization: opts.multiOrg,
      ac,
      roles,
      teams: {
        enabled: true,
        allowRemovingAllTeams: false,
      },
      sendInvitationEmail: opts.sendInvitationEmail,
      // Carry an optional staff phone on the invitation row so the admin can
      // set it at invite time; `autoEnroll` copies it onto the new user.
      schema: {
        invitation: {
          additionalFields: {
            phoneNumber: { type: 'string', required: false, input: true },
          },
        },
      },
    }),
    apiKey({
      // CLI keys are `vbt_<random>`. The dashboard's settings page and the
      // CLI device-grant flow both mint keys through this plugin.
      defaultPrefix: 'vbt_',
      // The vobase CLI authenticates with `Authorization: Bearer vbt_<key>`
      // rather than the plugin's default `x-api-key` header. Read `ctx.headers`
      // (always populated, including the programmatic `auth.api.getSession`
      // path used by `requireSession`) — `ctx.request` only exists for real
      // HTTP requests.
      customAPIKeyGetter: (ctx) => {
        const header = ctx.headers?.get('authorization') ?? ctx.request?.headers.get('authorization')
        const match = header?.match(BEARER_API_KEY_RE)
        return match?.[1] ?? null
      },
      // A valid API key mocks a session, so `requireSession` / `requireOrganization`
      // work uniformly for cookie callers (dashboard) and bearer callers (CLI).
      enableSessionForAPIKeys: true,
    }),
  ]
}
