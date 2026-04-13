import { logger } from '../../infra/logger';

/**
 * Token refresh result from a provider.
 */
export interface RefreshResult {
  accessToken: string;
  refreshToken?: string; // Some providers rotate refresh tokens
  expiresInSeconds?: number;
}

/**
 * Provider-specific token refresh function.
 * Given the current integration config (which contains clientId, clientSecret, refreshToken),
 * returns a new access token (and optionally a rotated refresh token).
 */
export type ProviderRefreshFn = (
  config: Record<string, unknown>,
) => Promise<RefreshResult>;

// ─── Built-in provider refresh implementations ──────────────────────

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MICROSOFT_TOKEN_URL = 'https://login.microsoftonline.com';

async function refreshGoogleToken(
  config: Record<string, unknown>,
): Promise<RefreshResult> {
  const clientId = config.clientId as string;
  const clientSecret = config.clientSecret as string;
  const refreshToken = config.refreshToken as string;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Google refresh requires clientId, clientSecret, and refreshToken in config',
    );
  }

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Google token refresh failed (${res.status}): ${error}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in?: number;
    refresh_token?: string;
  };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token, // Google may rotate
    expiresInSeconds: data.expires_in,
  };
}

async function refreshMicrosoftToken(
  config: Record<string, unknown>,
): Promise<RefreshResult> {
  const clientId = config.clientId as string;
  const clientSecret = config.clientSecret as string;
  const refreshToken = config.refreshToken as string;
  const tenantId = (config.tenantId as string) || 'common';

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Microsoft refresh requires clientId, clientSecret, and refreshToken in config',
    );
  }

  const res = await fetch(
    `${MICROSOFT_TOKEN_URL}/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    },
  );

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Microsoft token refresh failed (${res.status}): ${error}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in?: number;
    refresh_token?: string;
  };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token, // Microsoft rotates refresh tokens
    expiresInSeconds: data.expires_in,
  };
}

// ─── Registry ──────────────────────────────────────────────────────

const providerRefreshFns = new Map<string, ProviderRefreshFn>([
  ['google', refreshGoogleToken],
  ['google-drive', refreshGoogleToken],
  ['google-sheets', refreshGoogleToken],
  ['microsoft', refreshMicrosoftToken],
  ['microsoft-sharepoint', refreshMicrosoftToken],
  ['microsoft-onedrive', refreshMicrosoftToken],
]);

/** Register a custom provider refresh function. */
export function registerProviderRefresh(
  provider: string,
  fn: ProviderRefreshFn,
): void {
  providerRefreshFns.set(provider, fn);
}

/** Get the refresh function for a provider. Returns null if not registered. */
export function getProviderRefreshFn(
  provider: string,
): ProviderRefreshFn | null {
  return providerRefreshFns.get(provider) ?? null;
}

// ─── Platform refresh callback (single-consumer extensibility) ────

export type PlatformRefreshFn = (provider: string) => Promise<RefreshResult>;
let platformRefreshFn: PlatformRefreshFn | null = null;

/** Set the platform refresh callback. Only one consumer (platform integration).
 *  Last-write-wins (idempotent) — safe to call again during dev hot reload.
 *  The callback is a closure that captures its own config (env vars, HTTP client, etc.)
 *  at registration time. Core only passes the provider name. */
export function setPlatformRefresh(fn: PlatformRefreshFn): void {
  platformRefreshFn = fn;
}

/** Get the registered platform refresh callback, or null. */
export function getPlatformRefresh(): PlatformRefreshFn | null {
  return platformRefreshFn;
}

/**
 * Determine the refresh mode for an integration:
 * - 'local': has clientId + clientSecret + refreshToken → refresh directly with provider
 * - 'platform': a platform refresh callback is registered via setPlatformRefresh()
 * - null: cannot refresh (no credentials available)
 */
export function getRefreshMode(
  config: Record<string, unknown>,
): 'local' | 'platform' | null {
  if (config.clientId && config.clientSecret && config.refreshToken) {
    return 'local';
  }
  if (platformRefreshFn) {
    return 'platform';
  }
  if (process.env.PLATFORM_HMAC_SECRET && process.env.PLATFORM_URL) {
    logger.warn('[integrations:refresh] Platform env vars set but no refresh callback registered via setPlatformRefresh()');
  }
  return null;
}
