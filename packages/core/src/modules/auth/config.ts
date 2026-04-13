/**
 * Shared better-auth configuration.
 *
 * Single source of truth for plugins and user fields. Used by:
 * - Runtime: createAuthModule() in index.ts
 * - CLI: auth.ts at package root (schema generation)
 */

import { apiKey } from '@better-auth/api-key';
import type { BetterAuthPlugin, SocialProviders } from 'better-auth';
import { anonymous, organization } from 'better-auth/plugins';
import { emailOTP } from 'better-auth/plugins/email-otp';

/** Callback to deliver OTP codes (email, SMS, etc.). */
export type SendVerificationOTP = (data: {
  email: string;
  otp: string;
  type: 'sign-in' | 'email-verification' | 'forget-password' | 'change-email';
}) => Promise<void>;

/** Data passed to the invitation email callback. */
export type SendInvitationEmail = (data: {
  email: string;
  inviterName: string;
  organizationName: string;
  invitationId: string;
}) => Promise<void>;

export interface AuthModuleConfig {
  baseURL?: string;
  trustedOrigins?: string[];
  socialProviders?: SocialProviders;
  /** App name used in auth emails and UI (defaults to 'Vobase'). */
  appName?: string;
  /** Callback to deliver OTP codes. Required for email OTP sign-in to work. */
  sendVerificationOTP?: SendVerificationOTP;
  /** Callback to deliver organization invitation emails. */
  sendInvitationEmail?: SendInvitationEmail;
  /** Restrict sign-up to specific email domains (e.g. ['vobase.dev']). */
  allowedEmailDomains?: string[];
  /** Enable multi-org mode. Default: false (single org, soft-locked). */
  multiOrg?: boolean;
  /** Enable teams within organizations. Requires multiOrg or single-org. Default: false. */
  teams?: boolean;
  /** Additional better-auth plugins (e.g. dev-only plugins). No tables — routes only. */
  extraPlugins?: BetterAuthPlugin[];
}

/**
 * All plugins are always installed so the better-auth CLI generates complete
 * schema. Additional plugins can be injected via `extraPlugins` in config.
 */
export function getAuthPlugins(config?: AuthModuleConfig): BetterAuthPlugin[] {
  const plugins: BetterAuthPlugin[] = [
    apiKey({ rateLimit: { enabled: false } }) as BetterAuthPlugin,
    anonymous({
      emailDomainName: 'visitor.vobase.local',
    }) as BetterAuthPlugin,
    organization({
      allowUserToCreateOrganization: config?.multiOrg ?? false,
      teams: { enabled: config?.teams ?? true },
      ...(config?.sendInvitationEmail && {
        sendInvitationEmail: async (data) => {
          await config.sendInvitationEmail?.({
            email: data.email,
            inviterName: data.inviter.user.name,
            organizationName: data.organization.name,
            invitationId: data.id,
          });
        },
      }),
    }) as BetterAuthPlugin,
    emailOTP({
      sendVerificationOTP:
        config?.sendVerificationOTP ??
        (async () => {
          throw new Error('sendVerificationOTP not configured in auth config');
        }),
      otpLength: 6,
      expiresIn: 300,
      rateLimit: { window: 60, max: 1 },
    }) as BetterAuthPlugin,
  ];

  if (config?.extraPlugins) {
    plugins.push(...config.extraPlugins);
  }

  return plugins;
}

/** User additional fields shared between CLI and runtime. */
export const authUserFields = {
  role: {
    type: 'string',
    defaultValue: 'user',
    input: false,
  },
} as const;
