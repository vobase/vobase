import { createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';

import type { AuthAdapter } from '../contracts/auth';
import type { VobaseDb } from '../db/client';
import type { IntegrationsService } from '../modules/integrations/service';
import { logger } from './logger';

/**
 * Platform integration routes — opt-in endpoints for vobase-platform proxy.
 * Only active when PLATFORM_HMAC_SECRET env var is set.
 *
 * Provides:
 * - GET /api/auth/platform-callback?token=JWT — accept signed JWT from platform OAuth proxy, create session
 * - POST /api/integrations/whatsapp/configure — accept WhatsApp credentials from platform
 *
 * Webhook forwarding is handled separately: the channels webhook handler accepts
 * X-Platform-Signature as an alternative verification method when PLATFORM_HMAC_SECRET is set.
 */

function getPlatformSecret(): string | null {
  return process.env.PLATFORM_HMAC_SECRET || null;
}

/** Verify X-Platform-Signature header against raw body using HMAC-SHA256. */
export function verifyPlatformSignature(
  rawBody: string,
  signature: string,
): boolean {
  const secret = getPlatformSecret();
  if (!secret) return false;

  try {
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    if (signature.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

/** Check if platform integration is enabled (PLATFORM_HMAC_SECRET is set). */
export function isPlatformEnabled(): boolean {
  return !!getPlatformSecret();
}

/**
 * Decode and verify a platform handoff JWT using HMAC-SHA256.
 * Uses native crypto — no jose dependency needed in core.
 * JWT format: header.payload.signature (standard JWS compact)
 */
function verifyHandoffToken(
  token: string,
  secret: string,
  expectedAudience: string,
): {
  sub: string;
  provider: string;
  profile: { email: string; name: string; picture?: string; providerId: string };
} | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // Decode and verify header FIRST — reject invalid alg before expensive HMAC
    const headerRaw = parts[0];
    if (headerRaw.length > 512) return null; // Reject abnormally large headers
    const header = JSON.parse(Buffer.from(headerRaw, 'base64url').toString());
    if (header.alg !== 'HS256') return null;

    // Verify signature (HS256)
    const signingInput = `${parts[0]}.${parts[1]}`;
    const expectedSig = createHmac('sha256', secret)
      .update(signingInput)
      .digest('base64url');

    // Normalize the token's signature to base64url for comparison
    const tokenSig = parts[2].replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    if (expectedSig.length !== tokenSig.length) return null;
    if (!timingSafeEqual(Buffer.from(expectedSig), Buffer.from(tokenSig))) return null;

    // Decode payload
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

    // Verify expiry
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;

    // Verify audience
    if (payload.aud !== expectedAudience) return null;

    return {
      sub: payload.sub,
      provider: payload.provider,
      profile: payload.profile,
    };
  } catch {
    return null;
  }
}

export interface PlatformRoutesConfig {
  db: VobaseDb;
  authAdapter: AuthAdapter;
  integrationsService: IntegrationsService;
}

export function createPlatformRoutes(config: PlatformRoutesConfig) {
  const routes = new Hono();

  /**
   * GET /api/auth/platform-callback?token=JWT
   *
   * Accepts a signed JWT from the platform OAuth proxy containing the user's
   * OAuth profile. Verifies the JWT using PLATFORM_HMAC_SECRET,
   * creates or links the user via better-auth, and creates a session.
   */
  routes.get('/platform-callback', async (c) => {
    const secret = getPlatformSecret();
    if (!secret) return c.text('Not found', 404);

    const token = c.req.query('token');
    if (!token) return c.text('Missing token', 400);

    const baseUrl = process.env.BETTER_AUTH_URL || 'http://localhost:3000';
    const payload = verifyHandoffToken(token, secret, baseUrl);

    if (!payload) {
      return c.text('Invalid or expired token', 400);
    }

    const { profile, provider } = payload;
    if (!profile?.email || !provider) {
      return c.text('Invalid token payload', 400);
    }

    // Use trusted session creation — no password auth involved.
    // The JWT has already been cryptographically verified above.
    if (!config.authAdapter.createPlatformSession) {
      logger.error('[platform] AuthAdapter does not support createPlatformSession');
      return c.text('Platform authentication not supported', 501);
    }

    try {
      const session = await config.authAdapter.createPlatformSession({
        email: profile.email,
        name: profile.name,
        provider,
        providerId: profile.providerId,
      });

      if (!session) {
        logger.warn('[platform] Failed to create platform session', {
          email: profile.email,
          provider,
        });
        return c.text('Authentication failed', 401);
      }

      // Set the session cookie — better-auth uses 'better-auth.session_token' cookie name
      const secure = baseUrl.startsWith('https');
      const cookieName = secure ? '__Secure-better-auth.session_token' : 'better-auth.session_token';
      const cookieOpts = [
        `${cookieName}=${session.token}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${30 * 24 * 60 * 60}`, // 30 days
        ...(secure ? ['Secure'] : []),
      ].join('; ');

      c.header('set-cookie', cookieOpts);
      return c.redirect('/');
    } catch (err) {
      logger.error('[platform] Platform callback error', {
        error: err instanceof Error ? err.message : String(err),
      });
      return c.text('Authentication failed', 500);
    }
  });

  return routes;
}

/**
 * Platform integrations routes.
 * POST /api/integrations/whatsapp/configure — accept WhatsApp credentials from platform.
 * POST /api/integrations/token/update — accept refreshed tokens from platform.
 */
export function createPlatformIntegrationsRoutes(config: PlatformRoutesConfig) {
  const routes = new Hono();

  /**
   * POST /api/integrations/token/update
   * Platform pushes refreshed access tokens to tenants.
   * Body: { provider, accessToken, expiresInSeconds? }
   * Signed with X-Platform-Signature.
   */
  routes.post('/token/update', async (c) => {
    const secret = getPlatformSecret();
    if (!secret) return c.text('Not found', 404);

    const signature = c.req.header('x-platform-signature');
    if (!signature) return c.json({ error: 'Missing signature' }, 401);

    const rawBody = await c.req.text();
    if (!verifyPlatformSignature(rawBody, signature)) {
      return c.json({ error: 'Invalid signature' }, 401);
    }

    const body = JSON.parse(rawBody) as {
      provider: string;
      accessToken: string;
      expiresInSeconds?: number;
    };

    if (!body.provider || !body.accessToken) {
      return c.json({ error: 'Missing provider or accessToken' }, 400);
    }

    // Find the active integration for this provider
    const integration = await config.integrationsService.getActive(body.provider);
    if (!integration) {
      return c.json({ error: `No active integration for provider: ${body.provider}` }, 404);
    }

    // Only allow platform-managed integrations to be updated this way
    if (integration.authType !== 'platform') {
      return c.json({ error: 'Integration is not platform-managed' }, 403);
    }

    // Update the token
    const updatedConfig = { ...integration.config, accessToken: body.accessToken };
    const expiresAt = body.expiresInSeconds
      ? new Date(Date.now() + body.expiresInSeconds * 1000)
      : undefined;

    await config.integrationsService.updateConfig(integration.id, updatedConfig, { expiresAt });
    await config.integrationsService.markRefreshed(integration.id);

    logger.info('[platform] Token updated via platform push', {
      provider: body.provider,
      integrationId: integration.id,
      expiresAt: expiresAt?.toISOString(),
    });

    return c.json({ success: true });
  });

  routes.post('/whatsapp/configure', async (c) => {
    const secret = getPlatformSecret();
    if (!secret) return c.text('Not found', 404);

    const signature = c.req.header('x-platform-signature');
    if (!signature) return c.json({ error: 'Missing signature' }, 401);

    const rawBody = await c.req.text();
    if (!verifyPlatformSignature(rawBody, signature)) {
      return c.json({ error: 'Invalid signature' }, 401);
    }

    const body = JSON.parse(rawBody) as {
      accessToken: string;
      phoneNumberId?: string;
      wabaId?: string;
    };

    if (!body.accessToken) {
      return c.json({ error: 'Missing accessToken' }, 400);
    }

    // Store WhatsApp credentials in the integrations vault
    await config.integrationsService.connect(
      'whatsapp',
      {
        accessToken: body.accessToken,
        phoneNumberId: body.phoneNumberId || '',
        wabaId: body.wabaId || '',
        apiVersion: 'v22.0',
      },
      {
        authType: 'platform',
        label: 'WhatsApp (via platform)',
      },
    );

    logger.info('[platform] WhatsApp configured via platform', {
      wabaId: body.wabaId,
      phoneNumberId: body.phoneNumberId,
    });

    return c.json({ success: true });
  });

  return routes;
}
