/**
 * Shared better-auth configuration.
 *
 * Single source of truth for plugins and user fields. Used by:
 * - Runtime: createAuthModule() in index.ts
 * - CLI: auth.ts at package root (schema generation)
 */
import type { BetterAuthPlugin, SocialProviders } from 'better-auth';
import { apiKey } from '@better-auth/api-key';
import { anonymous, organization } from 'better-auth/plugins';
import { emailOTP } from 'better-auth/plugins/email-otp';
import { platformAuth } from './platform-plugin';

/** Callback to deliver OTP codes (email, SMS, etc.). */
export type SendVerificationOTP = (data: {
  email: string;
  otp: string;
  type: 'sign-in' | 'email-verification' | 'forget-password' | 'change-email';
}) => Promise<void>;

export interface AuthModuleConfig {
  baseURL?: string;
  trustedOrigins?: string[];
  socialProviders?: SocialProviders;
  /** App name used in auth emails and UI (defaults to 'Vobase'). */
  appName?: string;
  /** Callback to deliver OTP codes. Required for email OTP sign-in to work. */
  sendVerificationOTP?: SendVerificationOTP;
  /** Restrict sign-up to specific email domains (e.g. ['voltade.com']). */
  allowedEmailDomains?: string[];
  /** Additional better-auth plugins (e.g. dev-only plugins). No tables — routes only. */
  extraPlugins?: BetterAuthPlugin[];
}

/**
 * All plugins are always installed so the better-auth CLI generates complete
 * schema. platformAuth is the exception — it's env-gated because it adds
 * no tables, only routes.
 */
export function getAuthPlugins(config?: AuthModuleConfig): BetterAuthPlugin[] {
  const plugins: BetterAuthPlugin[] = [
    apiKey({ rateLimit: { enabled: false } }) as BetterAuthPlugin,
    anonymous({
      emailDomainName: 'visitor.vobase.local',
    }) as BetterAuthPlugin,
    organization() as BetterAuthPlugin,
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

  const platformSecret = process.env.PLATFORM_HMAC_SECRET;
  if (platformSecret) {
    plugins.push(
      platformAuth({ hmacSecret: platformSecret }) as BetterAuthPlugin,
    );
  }

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
