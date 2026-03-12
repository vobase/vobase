import type { WhatsAppProvider, WhatsAppMessage, WhatsAppResult } from '../../../contracts/notify';

export interface WabaConfig {
  phoneNumberId: string;
  accessToken: string;
  apiVersion?: string;
}

/**
 * WhatsApp Business API (WABA) provider.
 * Uses the Graph API to send template and text messages.
 */
export function createWabaProvider(config: WabaConfig): WhatsAppProvider {
  const apiVersion = config.apiVersion ?? 'v21.0';
  const baseUrl = `https://graph.facebook.com/${apiVersion}/${config.phoneNumberId}/messages`;

  return {
    async send(message: WhatsAppMessage): Promise<WhatsAppResult> {
      try {
        let body: Record<string, unknown>;

        if (message.template) {
          // Template message
          const components = message.template.parameters?.length
            ? [{
                type: 'body',
                parameters: message.template.parameters.map((p) => ({
                  type: 'text',
                  text: p,
                })),
              }]
            : undefined;

          body = {
            messaging_product: 'whatsapp',
            to: message.to,
            type: 'template',
            template: {
              name: message.template.name,
              language: { code: message.template.language },
              ...(components && { components }),
            },
          };
        } else if (message.text) {
          // Text message
          body = {
            messaging_product: 'whatsapp',
            to: message.to,
            type: 'text',
            text: { body: message.text },
          };
        } else {
          return { success: false, error: 'Message must have either template or text' };
        }

        const response = await fetch(baseUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          return { success: false, error: `WABA API error (${response.status}): ${errorBody}` };
        }

        const data = (await response.json()) as { messages?: Array<{ id: string }> };
        const messageId = data.messages?.[0]?.id;

        return { success: true, messageId };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
