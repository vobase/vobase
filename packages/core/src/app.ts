import { Hono } from 'hono';

import { contextMiddleware } from './ctx';
import { createDatabase, getPgliteClient } from './db/client';
import { errorHandler } from './infra/errors';
import { createHttpClient, type HttpClientOptions } from './infra/http-client';
import { createWorker } from './infra/job';
import { createScheduler } from './infra/queue';
import { createThrowProxy } from './infra/throw-proxy';
import {
  createPlatformRoutes,
  createPlatformIntegrationsRoutes,
  isPlatformEnabled,
} from './infra/platform';
import { createWebhookRoutes, type WebhookConfig } from './infra/webhooks';
import { createMcpHandler } from './mcp/server';
import type { VobaseModule } from './module';
import { createAuditModule } from './modules/audit';
import {
  type AuthModuleConfig,
  createAuthModule,
  optionalSessionMiddleware,
} from './modules/auth';
import {
  type ChannelsModuleConfig,
  createChannelsModule,
} from './modules/channels';
import { createResendAdapter } from './modules/channels/adapters/resend';
import { createSmtpAdapter } from './modules/channels/adapters/smtp';
import { createIntegrationsModule } from './modules/integrations';
import { createSequencesModule } from './modules/sequences';
import {
  createStorageModule,
  type StorageModuleConfig,
} from './modules/storage';
import type { StorageService } from './modules/storage/service';

export interface CreateAppConfig {
  modules: VobaseModule[];
  database: string;
  storage?: StorageModuleConfig;
  channels?: ChannelsModuleConfig;
  http?: HttpClientOptions;
  webhooks?: Record<string, WebhookConfig>;
  mcp?: { enabled?: boolean };
  trustedOrigins?: string[];
  auth?: Omit<AuthModuleConfig, 'trustedOrigins'>;
}

export async function createApp(config: CreateAppConfig) {
  const db = createDatabase(config.database);

  // Share the same database connection for pg-boss (PGlite can't have two instances on the same directory)
  const isPostgresUrl =
    config.database.startsWith('postgres://') ||
    config.database.startsWith('postgresql://');
  const scheduler = await createScheduler({
    connection: isPostgresUrl
      ? config.database
      : getPgliteClient(config.database),
  });

  const http = createHttpClient(config.http);

  // === Auth Module (always active) ===
  const authMod = createAuthModule(db, {
    ...config.auth,
    trustedOrigins: config.trustedOrigins,
  });
  const authAdapter = authMod.adapter;

  // === Storage Module (config-driven) ===
  let storageMod: ReturnType<typeof createStorageModule> | undefined;
  let storageService: StorageService;
  if (config.storage) {
    storageMod = createStorageModule(db, config.storage);
    storageService = storageMod.service;
  } else {
    storageService = createThrowProxy<StorageService>('storage');
  }

  // === Integrations Module (always active — credential vault) ===
  const integrationsMod = createIntegrationsModule(db);
  const integrationsService = integrationsMod.service;

  // === Channels Module (always created — adapters registered lazily) ===
  const channelsMod = createChannelsModule(db, config.channels ?? {});

  // Register adapters from integrations (DB-first)
  const waIntegration = await integrationsService.getActive('whatsapp');
  if (waIntegration) {
    const { createWhatsAppAdapter } = await import(
      './modules/channels/adapters/whatsapp'
    );
    channelsMod.registerAdapter(
      'whatsapp',
      createWhatsAppAdapter(
        {
          phoneNumberId: waIntegration.config.phoneNumberId as string,
          accessToken: waIntegration.config.accessToken as string,
          appSecret: waIntegration.config.appSecret as string,
          apiVersion: waIntegration.config.apiVersion as string | undefined,
        },
        http,
      ),
    );
  }

  const emailIntegration =
    (await integrationsService.getActive('resend')) ??
    (await integrationsService.getActive('smtp'));
  if (emailIntegration) {
    if (emailIntegration.provider === 'resend') {
      channelsMod.registerAdapter(
        'email',
        createResendAdapter({
          apiKey: emailIntegration.config.apiKey as string,
          from: emailIntegration.config.from as string,
        }),
      );
    } else if (emailIntegration.provider === 'smtp') {
      channelsMod.registerAdapter(
        'email',
        createSmtpAdapter({
          host: emailIntegration.config.host as string,
          port: emailIntegration.config.port as number,
          from: emailIntegration.config.from as string,
          secure: emailIntegration.config.secure as boolean | undefined,
          auth: emailIntegration.config.auth as
            | { user: string; pass: string }
            | undefined,
        }),
      );
    }
  }

  // Fall back to static config if no integrations found
  if (!waIntegration && config.channels?.whatsapp) {
    const { createWhatsAppAdapter } = await import(
      './modules/channels/adapters/whatsapp'
    );
    channelsMod.registerAdapter(
      'whatsapp',
      createWhatsAppAdapter(config.channels.whatsapp, http),
    );
  }
  if (!emailIntegration && config.channels?.email) {
    const emailConfig = config.channels.email;
    if (emailConfig.provider === 'resend' && emailConfig.resend) {
      channelsMod.registerAdapter(
        'email',
        createResendAdapter({
          apiKey: emailConfig.resend.apiKey,
          from: emailConfig.from,
        }),
      );
    } else if (emailConfig.provider === 'smtp' && emailConfig.smtp) {
      channelsMod.registerAdapter(
        'email',
        createSmtpAdapter({
          ...emailConfig.smtp,
          from: emailConfig.from,
        }),
      );
    }
  }

  const channelsService = channelsMod.service;

  // === Built-in Module Init ===
  const initCtx = {
    db,
    scheduler,
    http,
    storage: storageService,
    channels: channelsService,
    integrations: integrationsService,
  };

  const auditMod = createAuditModule();
  auditMod.init?.(initCtx);

  const seqMod = createSequencesModule();
  seqMod.init?.(initCtx);

  // === Base app with middleware ===
  const base = new Hono();
  base.onError(errorHandler);
  base.use(
    '*',
    contextMiddleware({
      db,
      scheduler,
      storage: storageService,
      channels: channelsService,
      integrations: integrationsService,
      http,
    }),
  );
  base.use('/api/*', optionalSessionMiddleware(authAdapter));

  // === Platform auth routes (must be mounted BEFORE the better-auth catch-all) ===
  if (isPlatformEnabled()) {
    const platformConfig = {
      db,
      authAdapter: authMod.adapter,
      integrationsService,
    };
    base.route('/api/auth', createPlatformRoutes(platformConfig));
    base.route(
      '/api/integrations',
      createPlatformIntegrationsRoutes(platformConfig),
    );
  }

  base.on(['POST', 'GET'], '/api/auth/*', (c) =>
    authAdapter.handler(c.req.raw),
  );

  // Mount via chaining to preserve route types for hc<AppType>
  const app = base.get('/health', (c) =>
    c.json({ status: 'ok', uptime: process.uptime() }),
  );

  // === Storage routes ===
  if (storageMod) {
    (app as Hono).route('/api/storage', storageMod.routes);
  }

  // === User Modules ===
  const userModules = config.modules;
  for (const mod of userModules) {
    mod.init?.(initCtx);
    (app as Hono).route(`/api/${mod.name}`, mod.routes);
  }

  // === Webhooks ===
  if (config.webhooks && Object.keys(config.webhooks).length > 0) {
    const webhookRouter = createWebhookRoutes(config.webhooks, {
      db,
      scheduler,
    });
    (app as Hono).route('', webhookRouter);
  }

  // === MCP + Jobs ===
  // === Channel webhook routes (always mounted) ===
  (app as Hono).route('/api/channels', channelsMod.routes);

  const builtInModules: VobaseModule[] = [
    authMod,
    auditMod,
    seqMod,
    integrationsMod,
    channelsMod,
  ];
  if (storageMod) builtInModules.push(storageMod);
  const allModules = [...builtInModules, ...userModules];

  if (config.mcp?.enabled) {
    const mcpHandler = createMcpHandler({
      db,
      modules: allModules,
      verifyApiKey: authMod.verifyApiKey,
      organizationEnabled: authMod.organizationEnabled,
    });
    (app as Hono).all('/mcp', async (c) => {
      const response = await mcpHandler(c.req.raw);
      return response;
    });
  }

  const allJobs = allModules.flatMap((module) => module.jobs ?? []);
  if (allJobs.length > 0) {
    await createWorker(allJobs, {
      connection: isPostgresUrl
        ? config.database
        : getPgliteClient(config.database),
    });
  }

  return app;
}
