import {
  createNanoid,
  createWhatsAppAdapter,
  getCtx,
  logger,
  unauthorized,
} from '@vobase/core';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { reinitChat } from '../ai/lib/chat-init';
import { channelInstances } from '../ai/schema';

export type IntegrationsRoutes = typeof integrationsRoutes;

const META_GRAPH_API = 'https://graph.facebook.com/v22.0';

const generateId = createNanoid();

export const integrationsRoutes = new Hono()

  // ─── Public config (needed by frontend for FB.login) ──────────────
  .get('/config', (c) => {
    const metaAppId = process.env.META_APP_ID ?? null;
    const metaConfigId = process.env.META_CONFIG_ID ?? null;
    return c.json({ metaAppId, metaConfigId });
  })

  // ─── List all channel instances ───────────────────────────────────
  .get('/instances', async (c) => {
    const ctx = getCtx(c);
    if (!ctx.user) throw unauthorized();

    const instances = await ctx.db.select().from(channelInstances);

    return c.json(instances);
  })

  // ─── WhatsApp connect (Embedded Signup code exchange) ─────────────
  .post('/whatsapp/connect', async (c) => {
    const ctx = getCtx(c);
    if (!ctx.user) throw unauthorized();

    const body = await c.req.json<{
      code: string;
      wabaId?: string;
      phoneNumberId?: string;
    }>();
    if (!body.code) {
      return c.json({ error: 'code is required' }, 400);
    }

    logger.info('WhatsApp connect: starting Embedded Signup flow', {
      hasWabaId: !!body.wabaId,
      hasPhoneNumberId: !!body.phoneNumberId,
    });

    const metaAppId = process.env.META_APP_ID;
    const metaAppSecret = process.env.META_APP_SECRET;
    if (!metaAppId || !metaAppSecret) {
      return c.json(
        { error: 'META_APP_ID and META_APP_SECRET must be set in environment' },
        500,
      );
    }

    // Step 1: Exchange authorization code for BISU access token
    // Code expires in ~60 seconds — must be exchanged immediately
    const tokenRes = await ctx.http.fetch(
      `${META_GRAPH_API}/oauth/access_token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: metaAppId,
          client_secret: metaAppSecret,
          code: body.code,
        }),
      },
    );
    if (!tokenRes.ok) {
      const err = await tokenRes.raw.text();
      return c.json({ error: `Code exchange failed: ${err}` }, 502);
    }
    const tokenData = tokenRes.data as { access_token: string };
    const accessToken = tokenData.access_token;
    logger.info('WhatsApp connect: code exchanged for BISU token');

    // Step 2: Get WABA ID and phone number ID
    // Prefer values from the session info listener (sent by frontend)
    let phoneNumberId = body.phoneNumberId;
    let wabaId = body.wabaId;
    let displayPhoneNumber: string | undefined;

    // Fallback: extract from debug_token if session listener didn't provide them
    if (!wabaId || !phoneNumberId) {
      try {
        const debugRes = await ctx.http.fetch(
          `${META_GRAPH_API}/debug_token?input_token=${accessToken}`,
          {
            headers: { Authorization: `Bearer ${metaAppId}|${metaAppSecret}` },
          },
        );
        const debugData = debugRes.data as {
          data?: {
            granular_scopes?: Array<{
              scope: string;
              target_ids?: string[];
            }>;
          };
        };

        if (!wabaId) {
          const wabaScope = debugData.data?.granular_scopes?.find(
            (s) => s.scope === 'whatsapp_business_management',
          );
          wabaId = wabaScope?.target_ids?.[0];
        }

        if (!phoneNumberId && wabaId) {
          const phoneRes = await ctx.http.fetch(
            `${META_GRAPH_API}/${wabaId}/phone_numbers`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
          );
          const phoneData = phoneRes.data as {
            data?: Array<{ id: string; display_phone_number: string }>;
          };
          phoneNumberId = phoneData.data?.[0]?.id;
          displayPhoneNumber = phoneData.data?.[0]?.display_phone_number;
        }
      } catch {
        // Continue — session data may be sufficient
      }
    }

    if (!phoneNumberId || !wabaId) {
      logger.warn(
        'WhatsApp connect: could not determine WABA or phone number',
        { wabaId, phoneNumberId },
      );
      return c.json(
        {
          error:
            'Could not determine WABA or phone number. Check your Meta App permissions.',
        },
        502,
      );
    }

    logger.info('WhatsApp connect: WABA and phone resolved', {
      wabaId,
      phoneNumberId,
    });

    // Step 3: Store credentials via integrations service
    const integration = await ctx.integrations.connect(
      'whatsapp',
      {
        accessToken,
        phoneNumberId,
        wabaId,
        appSecret: metaAppSecret,
      },
      {
        authType: 'embedded_signup',
        scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
        createdBy: ctx.user.id,
      },
    );

    // Step 4: Create a channel_instance record for this WhatsApp number
    const instanceId = generateId();
    const label = displayPhoneNumber
      ? `WhatsApp ${displayPhoneNumber}`
      : `WhatsApp ${phoneNumberId}`;

    await ctx.db.insert(channelInstances).values({
      id: instanceId,
      type: 'whatsapp',
      source: 'self',
      integrationId: integration.id,
      label,
      status: 'active',
    });

    logger.info('WhatsApp connect: channel_instance created', {
      instanceId,
      integrationId: integration.id,
    });

    // Step 5: Hot-reload WhatsApp adapter so webhooks work immediately (no restart needed)
    ctx.channels.registerAdapter(
      'whatsapp',
      createWhatsAppAdapter({
        phoneNumberId,
        accessToken,
        appSecret: metaAppSecret,
      }),
    );
    logger.info('WhatsApp connect: adapter hot-reloaded');

    // Step 6: Reinitialize chat to pick up the new channel instance
    await reinitChat({
      db: ctx.db,
      scheduler: ctx.scheduler,
      channels: ctx.channels,
    });
    logger.info('WhatsApp connect: chat reinitialized');

    logger.info('WhatsApp connect: credentials stored, queueing setup job', {
      integrationId: integration.id,
    });

    // Step 7: Queue post-signup setup (webhook subscription, callback URL, phone registration)
    // Runs as a background job with retry via pg-boss — survives transient Meta API failures
    await ctx.scheduler.add(
      'integrations:whatsapp-setup',
      {
        integrationId: integration.id,
      },
      {
        retryLimit: 5,
      },
    );

    return c.json({
      success: true,
      id: integration.id,
      instanceId,
      phoneNumberId,
      wabaId,
    });
  })

  // ─── Per-instance disconnect ──────────────────────────────────────
  .post('/instances/:id/disconnect', async (c) => {
    const ctx = getCtx(c);
    if (!ctx.user) throw unauthorized();

    const instanceId = c.req.param('id');

    const [instance] = await ctx.db
      .select()
      .from(channelInstances)
      .where(eq(channelInstances.id, instanceId));

    if (!instance) {
      return c.json({ error: 'Channel instance not found' }, 404);
    }

    // Delete channel_instance record
    await ctx.db
      .delete(channelInstances)
      .where(eq(channelInstances.id, instanceId));

    // Disconnect the underlying integration if present
    if (instance.integrationId) {
      await ctx.integrations.disconnect(instance.integrationId);
    }

    // Reinitialize chat to drop the removed instance
    await reinitChat({
      db: ctx.db,
      scheduler: ctx.scheduler,
      channels: ctx.channels,
    });
    logger.info('Instance disconnect: chat reinitialized', { instanceId });

    return c.json({ success: true });
  })

  // ─── WhatsApp test message ────────────────────────────────────────
  .post('/whatsapp/test', async (c) => {
    const ctx = getCtx(c);
    if (!ctx.user) throw unauthorized();

    const body = await c.req.json<{ to: string }>();
    if (!body.to) {
      return c.json({ error: 'Phone number (to) is required' }, 400);
    }

    try {
      logger.info('WhatsApp test: sending message', { to: body.to });
      const result = await ctx.channels.whatsapp.send({
        to: body.to,
        text: 'Test message from Vobase',
      });
      logger.info('WhatsApp test: send result', { result });
      return c.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('WhatsApp test: send error', { error: message });
      return c.json({ success: false, error: message }, 500);
    }
  })

  // ─── Future providers (stubs) ─────────────────────────────────────
  .post('/telegram/connect', (c) => {
    return c.json({ error: 'Not implemented' }, 501);
  })

  .post('/email/connect', (c) => {
    return c.json({ error: 'Not implemented' }, 501);
  })

  .post('/voice/connect', (c) => {
    return c.json({ error: 'Not implemented' }, 501);
  });
