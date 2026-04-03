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
import { platformAuth } from './platform-plugin';

export interface AuthModuleConfig {
  baseURL?: string;
  trustedOrigins?: string[];
  socialProviders?: SocialProviders;
}

/** All plugins are always installed. Tables always exist. */
export function getAuthPlugins(): BetterAuthPlugin[] {
  const plugins: BetterAuthPlugin[] = [
    apiKey({ rateLimit: { enabled: false } }) as BetterAuthPlugin,
    anonymous({
      emailDomainName: 'visitor.vobase.local',
    }) as BetterAuthPlugin,
    organization() as BetterAuthPlugin,
  ];

  const platformSecret = process.env.PLATFORM_HMAC_SECRET;
  if (platformSecret) {
    plugins.push(
      platformAuth({ hmacSecret: platformSecret }) as BetterAuthPlugin,
    );
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
