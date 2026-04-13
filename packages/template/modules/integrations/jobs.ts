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
 * Post-signup setup job: subscribes app to WABA webhooks and registers the phone number.
 * The app-level webhook callback URL is configured once in the Meta App Dashboard.
 * Retries automatically via pg-boss on failure.
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
    const { channelInstanceId } = data as {
      integrationId: string;
      channelInstanceId?: string;
    };

    // Step 1: Subscribe app to WABA webhooks with per-WABA callback override
    logger.info('WhatsApp setup job: subscribing app to WABA', { wabaId });

    const baseUrl = process.env.WEBHOOK_BASE_URL || process.env.BETTER_AUTH_URL;

    const subBody: Record<string, string> = {};
    if (baseUrl) {
      const webhookUrl = channelInstanceId
        ? `${baseUrl}/api/channels/webhook/whatsapp/${channelInstanceId}`
        : `${baseUrl}/api/channels/webhook/whatsapp`;
      subBody.override_callback_uri = webhookUrl;
      subBody.verify_token =
        process.env.META_WEBHOOK_VERIFY_TOKEN ?? 'vobase-webhook-verify';
      logger.info('WhatsApp setup job: setting WABA callback override', {
        webhookUrl,
      });
    }

    const subRes = await http.fetch(
      `${META_GRAPH_API}/${wabaId}/subscribed_apps`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(Object.keys(subBody).length > 0 && {
            'Content-Type': 'application/json',
          }),
        },
        ...(Object.keys(subBody).length > 0 && {
          body: JSON.stringify(subBody),
        }),
      },
    );
    if (!subRes.ok) {
      const body = JSON.stringify(subRes.data);
      logger.error('WhatsApp setup job: subscribe to WABA failed', {
        status: subRes.status,
        body,
      });
      throw new Error(`Subscribe to WABA failed (${subRes.status}): ${body}`);
    }

    logger.info('WhatsApp setup job: WABA subscription complete');

    // Step 2: Register the phone number for messaging
    logger.info('WhatsApp setup job: registering phone number', {
      phoneNumberId,
    });
    const regBody = new URLSearchParams({
      messaging_product: 'whatsapp',
      pin: process.env.WHATSAPP_REGISTRATION_PIN ?? '000000',
    });
    const regRes = await http.fetch(
      `${META_GRAPH_API}/${phoneNumberId}/register`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: regBody,
      },
    );
    if (!regRes.ok) {
      const body = JSON.stringify(regRes.data);
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
