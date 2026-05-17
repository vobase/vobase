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
import { anonymous } from 'better-auth/plugins/anonymous'
import { bearer } from 'better-auth/plugins/bearer'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { magicLink } from 'better-auth/plugins/magic-link'
import { organization } from 'better-auth/plugins/organization'
import { phoneNumber } from 'better-auth/plugins/phone-number'

import { ac, roles } from './ac'
import { E164_RE } from './e164'
import { deliverMagicLinkToken } from './magic-link'
import { deliverPhoneOtp } from './phone-otp'

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
      // The plugin contributes `user.phoneNumber` / `phoneNumberVerified`
      // (admin-set at invite time, see `auth/index.ts`). `sendOTP` is wired to
      // the phone-OTP captor in `auth/phone-otp.ts` — invoking
      // `auth.api.sendPhoneNumberOTP` from `mintPhoneOtp` causes this callback
      // to fire with the freshly-minted `code`; the captor's nonce travels
      // through the `x-captor-nonce` request header set by the captor's
      // sender, and the deliver helper resolves the pending mint promise.
      sendOTP: ({ phoneNumber: pn, code }, ctx) => {
        deliverPhoneOtp({ phoneNumber: pn, code, ctxHeaders: ctx?.headers })
      },
      phoneNumberValidator: (value) => E164_RE.test(value),
    }),
    magicLink({
      storeToken: 'hashed', // REQUIRED — defaults to 'plain' (verified at .../plugins/magic-link/index.mjs:26)
      expiresIn: 60 * 60 * 24, // 24h, matches Meta UTILITY re-engagement window
      disableSignUp: true, // staff already provisioned via org-invite path
      sendMagicLink: async ({ token, metadata }) => {
        // url arg is the tenant's own /magic-link/verify URL — DISCARDED.
        // metadata.{nonce,tenantId,organizationId,callbackURL} are used by the captor
        // to construct the platform URL. See auth/magic-link.ts for details.
        deliverMagicLinkToken({ token, metadata })
      },
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
      // Plugin default is 10 requests / 24h per key, which is way too tight
      // for an operator CLI that fans out catalog + verb calls (and re-fetches
      // the catalog on `--refresh`). The plugin renders a tripped limit as
      // `RATE_LIMITED` which `requireSession` re-throws as a plain-text 500,
      // making it look like the key was revoked. Surface a generous cap until
      // we wire a real rate-limit policy.
      rateLimit: { enabled: true, timeWindow: 60_000, maxRequests: 600 },
    }),
  ]
}
