import {
  conflict,
  createNanoid,
  createWhatsAppAdapter,
  getCtx,
  logger,
  notFound,
  unauthorized,
  validation,
} from '@vobase/core';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import { getAgent } from '../../../mastra/agents';
import { reinitChat } from '../lib/chat-init';
import { getModuleDeps } from '../lib/deps';
import {
  channelInstances,
  channelRoutings,
  consultations,
  conversations,
} from '../schema';

const META_GRAPH_API = 'https://graph.facebook.com/v22.0';

const generateId = createNanoid();

const createChannelInstanceSchema = z.object({
  type: z.string().min(1),
  label: z.string().min(1),
  source: z.enum(['env', 'self', 'platform', 'sandbox']),
  integrationId: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const updateChannelInstanceSchema = z.object({
  label: z.string().min(1).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(['active', 'disconnected', 'error']).optional(),
});

const createEndpointSchema = z.object({
  name: z.string().min(1),
  channelInstanceId: z.string().min(1),
  agentId: z.string().min(1),
  assignmentPattern: z
    .enum(['direct', 'router', 'workflow'])
    .optional()
    .default('direct'),
  config: z.record(z.string(), z.unknown()).optional(),
});

const updateEndpointSchema = z.object({
  name: z.string().min(1).optional(),
  channelInstanceId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  assignmentPattern: z.enum(['direct', 'router', 'workflow']).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

const completeSetupSchema = z.object({
  name: z.string().min(1),
  agentId: z.string().min(1),
  assignmentPattern: z
    .enum(['direct', 'router', 'workflow'])
    .optional()
    .default('direct'),
});

const whatsappConnectSchema = z.object({
  code: z.string(),
  wabaId: z.string().optional(),
  phoneNumberId: z.string().optional(),
  name: z.string().optional(),
  agentId: z.string().optional(),
});

export const channelsHandlers = new Hono()
  /** GET /channels/config — Returns Meta config for frontend FB SDK. */
  .get('/channels/config', (c) => {
    const metaAppId = process.env.META_APP_ID ?? null;
    const metaConfigId = process.env.META_CONFIG_ID ?? null;
    const platformUrl = process.env.PLATFORM_URL ?? null;
    return c.json({ metaAppId, metaConfigId, platformUrl });
  })
  /** POST /channels/whatsapp/connect — Embedded Signup code exchange and channel setup. */
  .post('/channels/whatsapp/connect', async (c) => {
    const ctx = getCtx(c);
    if (!ctx.user) throw unauthorized();

    const body = whatsappConnectSchema.parse(await c.req.json());

    logger.info('WhatsApp connect: starting Embedded Signup flow', {
      hasWabaId: !!body.wabaId,
      hasPhoneNumberId: !!body.phoneNumberId,
    });

    const metaAppId = process.env.META_APP_ID;
    const metaAppSecret = process.env.META_APP_SECRET;
    if (!metaAppId || !metaAppSecret) {
      return c.json(
        {
          error: {
            code: 'SERVER_ERROR',
            message:
              'META_APP_ID and META_APP_SECRET must be set in environment',
          },
        },
        500,
      );
    }

    // Validate agent if provided
    if (body.agentId) {
      const registered = getAgent(body.agentId);
      if (!registered)
        throw validation({ agentId: `Agent '${body.agentId}' not found` });
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
      const err = JSON.stringify(tokenRes.data);
      return c.json(
        {
          error: {
            code: 'BAD_GATEWAY',
            message: `Code exchange failed: ${err}`,
          },
        },
        502,
      );
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
          error: {
            code: 'BAD_GATEWAY',
            message:
              'Could not determine WABA or phone number. Check your Meta App permissions.',
          },
        },
        502,
      );
    }

    logger.info('WhatsApp connect: WABA and phone resolved', {
      wabaId,
      phoneNumberId,
    });

    // Step 3: Store credentials via integrations service (OUTSIDE transaction)
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

    // Step 4: Create channel_instance (and optionally channelRouting) in a transaction
    const instanceId = generateId();
    const label = displayPhoneNumber
      ? `WhatsApp ${displayPhoneNumber}`
      : `WhatsApp ${phoneNumberId}`;

    try {
      await ctx.db.transaction(async (tx) => {
        await tx.insert(channelInstances).values({
          id: instanceId,
          type: 'whatsapp',
          source: 'self',
          integrationId: integration.id,
          label,
          status: 'active',
        });

        if (body.name && body.agentId) {
          await tx.insert(channelRoutings).values({
            name: body.name,
            channelInstanceId: instanceId,
            agentId: body.agentId,
            assignmentPattern: 'direct',
            config: {},
          });
        }
      });
    } catch (err) {
      // Compensating action: disconnect integration if transaction failed
      await ctx.integrations.disconnect(integration.id);
      throw err;
    }

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

    // Step 6: Reinitialize chat to pick up the new channel instance (non-fatal)
    try {
      await reinitChat({
        db: ctx.db,
        scheduler: ctx.scheduler,
        channels: ctx.channels,
        realtime: getModuleDeps().realtime,
      });
      logger.info('WhatsApp connect: chat reinitialized');
    } catch (err) {
      logger.error('WhatsApp connect: reinitChat failed (non-fatal)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    logger.info('WhatsApp connect: credentials stored, queueing setup job', {
      integrationId: integration.id,
    });

    // Step 7: Queue post-signup setup (webhook subscription, callback URL, phone registration)
    await ctx.scheduler.add(
      'integrations:whatsapp-setup',
      {
        integrationId: integration.id,
        channelInstanceId: instanceId,
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
  /** POST /channels/whatsapp/test — Send a test WhatsApp message. */
  .post('/channels/whatsapp/test', async (c) => {
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
        text: `Test message from ${process.env.VITE_PRODUCT_NAME || 'Vobase'}`,
      });
      logger.info('WhatsApp test: send result', { result });
      return c.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('WhatsApp test: send error', { error: message });
      return c.json(
        { success: false, error: { code: 'SERVER_ERROR', message } },
        500,
      );
    }
  })
  /** GET /instances — List all channel instances. */
  .get('/instances', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const rows = await db
      .select()
      .from(channelInstances)
      .orderBy(desc(channelInstances.createdAt));

    return c.json(rows);
  })
  /** GET /instances/:id — Get a single channel instance. */
  .get('/instances/:id', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const [row] = await db
      .select()
      .from(channelInstances)
      .where(eq(channelInstances.id, c.req.param('id')));

    if (!row) throw notFound('Channel instance not found');

    return c.json(row);
  })
  /** POST /instances — Create a channel instance. */
  .post('/instances', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const body = createChannelInstanceSchema.parse(await c.req.json());

    const [row] = await db
      .insert(channelInstances)
      .values({
        type: body.type,
        label: body.label,
        source: body.source,
        ...(body.integrationId !== undefined && {
          integrationId: body.integrationId,
        }),
        config: body.config ?? {},
      })
      .returning();

    return c.json(row, 201);
  })
  /** PATCH /instances/:id — Update a channel instance. */
  .patch('/instances/:id', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const body = updateChannelInstanceSchema.parse(await c.req.json());
    const instanceId = c.req.param('id');

    const [existing] = await db
      .select()
      .from(channelInstances)
      .where(eq(channelInstances.id, instanceId));

    if (!existing) throw notFound('Channel instance not found');

    const [row] = await db
      .update(channelInstances)
      .set({
        ...(body.label !== undefined && { label: body.label }),
        ...(body.config !== undefined && { config: body.config }),
        ...(body.status !== undefined && { status: body.status }),
      })
      .where(eq(channelInstances.id, instanceId))
      .returning();

    return c.json(row);
  })
  /** DELETE /instances/:id — Delete a channel instance. */
  .delete('/instances/:id', async (c) => {
    const ctx = getCtx(c);
    if (!ctx.user) throw unauthorized();

    const { db, integrations, scheduler, channels } = ctx;
    const instanceId = c.req.param('id');

    const [existing] = await db
      .select()
      .from(channelInstances)
      .where(eq(channelInstances.id, instanceId));

    if (!existing) throw notFound('Channel instance not found');

    // M8: Prevent deletion if active conversations exist on channel routings bound to this instance
    const activeConversations = await db
      .select({ id: conversations.id })
      .from(conversations)
      .innerJoin(
        channelRoutings,
        eq(conversations.channelRoutingId, channelRoutings.id),
      )
      .where(
        and(
          eq(channelRoutings.channelInstanceId, instanceId),
          eq(conversations.status, 'active'),
        ),
      )
      .limit(1);

    if (activeConversations.length > 0) {
      return c.json(
        {
          error: {
            code: 'CONFLICT',
            message:
              'This channel has active conversations. Complete or end them before removing.',
          },
        },
        409,
      );
    }

    // Clean up completed conversations and channel routings before deleting instance (FK safety)
    const relatedRoutingIds = (
      await db
        .select({ id: channelRoutings.id })
        .from(channelRoutings)
        .where(eq(channelRoutings.channelInstanceId, instanceId))
    ).map((r) => r.id);

    if (relatedRoutingIds.length > 0) {
      // Batch: get all conversation IDs for these routings
      const relatedConvIds = (
        await db
          .select({ id: conversations.id })
          .from(conversations)
          .where(inArray(conversations.channelRoutingId, relatedRoutingIds))
      ).map((c) => c.id);

      // Batch: delete consultations → conversations → routings
      if (relatedConvIds.length > 0) {
        await db
          .delete(consultations)
          .where(inArray(consultations.conversationId, relatedConvIds));
        await db
          .delete(conversations)
          .where(inArray(conversations.id, relatedConvIds));
      }
      await db
        .delete(channelRoutings)
        .where(inArray(channelRoutings.id, relatedRoutingIds));
    }

    await db
      .delete(channelInstances)
      .where(eq(channelInstances.id, instanceId));

    // Disconnect the underlying integration if present
    if (existing.integrationId) {
      await integrations.disconnect(existing.integrationId);
    }

    // Reinitialize chat to drop the removed instance (non-fatal)
    try {
      await reinitChat({
        db,
        scheduler,
        channels,
        realtime: getModuleDeps().realtime,
      });
      logger.info('Instance delete: chat reinitialized', { instanceId });
    } catch (err) {
      logger.error('Instance delete: reinitChat failed (non-fatal)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return c.json({ success: true });
  })
  /** POST /instances/:id/complete-setup — Create a routing for a platform-provisioned channel instance. */
  .post('/instances/:id/complete-setup', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const body = completeSetupSchema.parse(await c.req.json());
    const instanceId = c.req.param('id');

    const [instance] = await db
      .select()
      .from(channelInstances)
      .where(eq(channelInstances.id, instanceId));

    if (!instance) throw notFound('Channel instance not found');

    const [existingRouting] = await db
      .select()
      .from(channelRoutings)
      .where(eq(channelRoutings.channelInstanceId, instanceId))
      .limit(1);

    if (existingRouting)
      throw conflict('Channel instance already has a routing configured');

    const agent = getAgent(body.agentId);
    if (!agent) throw validation({ agentId: 'Agent not found' });

    const [row] = await db
      .insert(channelRoutings)
      .values({
        name: body.name,
        channelInstanceId: instanceId,
        agentId: body.agentId,
        assignmentPattern: body.assignmentPattern,
        config: {},
      })
      .returning();

    return c.json(row, 201);
  })
  /** GET /endpoints — List configured channel routings. */
  .get('/channel-routings', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const rows = await db
      .select()
      .from(channelRoutings)
      .orderBy(desc(channelRoutings.createdAt));

    return c.json(rows);
  })
  /** POST /endpoints — Create a channel routing. */
  .post('/channel-routings', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const body = createEndpointSchema.parse(await c.req.json());

    // Validate agent exists
    const registered = getAgent(body.agentId);
    if (!registered)
      throw validation({ agentId: `Agent '${body.agentId}' not found` });

    const [row] = await db
      .insert(channelRoutings)
      .values({
        name: body.name,
        channelInstanceId: body.channelInstanceId,
        agentId: body.agentId,
        assignmentPattern: body.assignmentPattern,
        config: body.config ?? {},
      })
      .returning();

    return c.json(row, 201);
  })
  /** PATCH /endpoints/:id — Update a channel routing. */
  .patch('/channel-routings/:id', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const body = updateEndpointSchema.parse(await c.req.json());
    const channelRoutingId = c.req.param('id');

    const [existing] = await db
      .select()
      .from(channelRoutings)
      .where(eq(channelRoutings.id, channelRoutingId));

    if (!existing) throw notFound('Channel routing not found');

    const [row] = await db
      .update(channelRoutings)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.channelInstanceId !== undefined && {
          channelInstanceId: body.channelInstanceId,
        }),
        ...(body.agentId !== undefined && { agentId: body.agentId }),
        ...(body.assignmentPattern !== undefined && {
          assignmentPattern: body.assignmentPattern,
        }),
        ...(body.config !== undefined && { config: body.config }),
        ...(body.enabled !== undefined && { enabled: body.enabled }),
      })
      .where(eq(channelRoutings.id, channelRoutingId))
      .returning();

    return c.json(row);
  })
  /** GET /channels/status — List channel instances with active conversation counts. */
  .get('/channels/status', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    // Two queries to avoid correlated subquery issues with Drizzle SQL templates
    const instances = await db
      .select()
      .from(channelInstances)
      .orderBy(channelInstances.type);

    const conversationCounts = await db
      .select({
        channelInstanceId: conversations.channelInstanceId,
        count: count(),
      })
      .from(conversations)
      .where(eq(conversations.status, 'active'))
      .groupBy(conversations.channelInstanceId);

    const countMap = new Map(
      conversationCounts.map((r) => [r.channelInstanceId, Number(r.count)]),
    );

    const channels = instances.map((inst) => ({
      id: inst.id,
      type: inst.type,
      label: inst.label,
      status: inst.status,
      activeSessionCount: countMap.get(inst.id) ?? 0,
    }));

    return c.json({ channels });
  });
