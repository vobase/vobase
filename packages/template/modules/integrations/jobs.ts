import type { IntegrationsService, VobaseDb } from '@vobase/core';
import { createHttpClient, defineJob, logger } from '@vobase/core';

const http = createHttpClient();

const META_GRAPH_API = 'https://graph.facebook.com/v22.0';

let _moduleDb: VobaseDb;
let moduleIntegrations: IntegrationsService;

export function setIntegrationsDeps(
  db: VobaseDb,
  integrations: IntegrationsService,
) {
  _moduleDb = db;
  moduleIntegrations = integrations;
}

/**
 * Post-signup setup job: subscribes app to WABA webhooks, sets webhook callback URL,
 * and registers the phone number. Retries automatically via pg-boss on failure.
 */
export const whatsappSetupJob = defineJob(
  'integrations:whatsapp-setup',
  async (data: unknown) => {
    const { integrationId } = data as {
      integrationId: string;
    };

    logger.info('WhatsApp setup job: starting', { integrationId });

    const integration = await moduleIntegrations.getById(integrationId);
    if (!integration || integration.status !== 'active') {
      logger.warn('WhatsApp setup job: integration not found or inactive', {
        integrationId,
      });
      return;
    }

    const { accessToken, wabaId, phoneNumberId } = integration.config as {
      accessToken: string;
      wabaId: string;
      phoneNumberId: string;
    };

    const metaAppId = process.env.META_APP_ID;
    const metaAppSecret = process.env.META_APP_SECRET;
    if (!metaAppId || !metaAppSecret) {
      throw new Error(
        'META_APP_ID and META_APP_SECRET required for WhatsApp setup',
      );
    }

    // Step 1: Subscribe app to WABA webhooks
    logger.info('WhatsApp setup job: subscribing app to WABA', { wabaId });
    const subRes = await http.fetch(
      `${META_GRAPH_API}/${wabaId}/subscribed_apps`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!subRes.ok) {
      const body = await subRes.raw.text();
      logger.error('WhatsApp setup job: subscribe to WABA failed', {
        status: subRes.status,
        body,
      });
      throw new Error(`Subscribe to WABA failed (${subRes.status}): ${body}`);
    }

    logger.info('WhatsApp setup job: WABA subscription complete');

    // Step 2: Set webhook callback URL to point to this server
    const baseUrl = process.env.BETTER_AUTH_URL;
    if (baseUrl) {
      // Include instanceId in webhook URL for per-instance routing
      const { channelInstanceId } = data as {
        integrationId: string;
        channelInstanceId?: string;
      };
      const webhookUrl = channelInstanceId
        ? `${baseUrl}/api/channels/webhook/whatsapp/${channelInstanceId}`
        : `${baseUrl}/api/channels/webhook/whatsapp`;
      logger.info('WhatsApp setup job: setting webhook callback URL', {
        webhookUrl,
      });
      const verifyToken =
        process.env.META_WEBHOOK_VERIFY_TOKEN ?? 'vobase-webhook-verify';
      const cbRes = await http.fetch(
        `${META_GRAPH_API}/${metaAppId}/subscriptions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${metaAppId}|${metaAppSecret}`,
            'Content-Type': 'application/json',
          },
          body: {
            object: 'whatsapp_business_account',
            callback_url: webhookUrl,
            verify_token: verifyToken,
            fields: ['messages'],
          },
        },
      );
      if (!cbRes.ok) {
        const body = await cbRes.raw.text();
        logger.error('WhatsApp setup job: set webhook URL failed', {
          status: cbRes.status,
          body,
        });
        throw new Error(`Set webhook URL failed (${cbRes.status}): ${body}`);
      }
    }

    logger.info('WhatsApp setup job: webhook URL configured');

    // Step 3: Register the phone number for messaging
    logger.info('WhatsApp setup job: registering phone number', {
      phoneNumberId,
    });
    const regRes = await http.fetch(
      `${META_GRAPH_API}/${phoneNumberId}/register`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: {
          messaging_product: 'whatsapp',
          pin: '000000',
        },
      },
    );
    // 200 = success, 4xx with "already registered" is also fine for coexistence
    if (!regRes.ok) {
      const body = await regRes.raw.text();
      // Don't retry if already registered
      const isAlreadyRegistered =
        body.includes('already registered') ||
        body.includes('already been registered');
      const isSmbNotAvailable = body.includes('not available for SMB');
      if (!isAlreadyRegistered && !isSmbNotAvailable) {
        logger.error('WhatsApp setup job: phone registration failed', {
          status: regRes.status,
          body,
        });
        throw new Error(
          `Phone registration failed (${regRes.status}): ${body}`,
        );
      }
      logger.info(
        'WhatsApp setup job: phone registration skipped (coexistence/already registered)',
      );
    }

    logger.info(
      'WhatsApp setup job: all steps complete, marking webhook ready',
    );

    // All steps succeeded — mark webhook as ready so the frontend can see it
    await moduleIntegrations.updateConfig(integrationId, {
      ...integration.config,
      webhookReady: true,
    });
  },
);
