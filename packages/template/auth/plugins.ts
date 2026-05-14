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
import { organization } from 'better-auth/plugins/organization'

import { ac, roles } from './ac'

/** Bearer-token shape the vobase CLI sends: `Authorization: Bearer vbt_<key>`. */
const BEARER_API_KEY_RE = /^Bearer\s+(vbt_[A-Za-z0-9_-]+)$/u

type EmailOtpOptions = NonNullable<Parameters<typeof emailOTP>[0]>
type OrganizationOptions = NonNullable<Parameters<typeof organization>[0]>

export interface AuthPluginOpts {
  /** Whether users may create their own organizations (`VOBASE_MULTI_ORG`). */
  multiOrg: boolean
  sendVerificationOTP: EmailOtpOptions['sendVerificationOTP']
  sendInvitationEmail: OrganizationOptions['sendInvitationEmail']
}

export function buildAuthPlugins(opts: AuthPluginOpts) {
  return [
    // Bearer tokens let the public /chat page authenticate via
    // `Authorization: Bearer <token>` instead of cookies. That isolates the
    // widget's anonymous session from the dashboard cookie session on the
    // same origin.
    bearer(),
    anonymous(),
    emailOTP({
      sendVerificationOTP: opts.sendVerificationOTP,
      otpLength: 6,
      expiresIn: 300,
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
