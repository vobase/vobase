import type { VobaseDb } from '../../db/client';
import type {
  EmailProvider,
  EmailMessage,
  EmailResult,
  WhatsAppProvider,
  WhatsAppMessage,
  WhatsAppResult,
} from '../../contracts/notify';
import { createThrowProxy } from '../../infra/throw-proxy';
import { notifyLog } from './schema';

export interface EmailChannel {
  send(message: EmailMessage): Promise<EmailResult>;
}

export interface WhatsAppChannel {
  send(message: WhatsAppMessage): Promise<WhatsAppResult>;
}

export interface NotifyService {
  email: EmailChannel;
  whatsapp: WhatsAppChannel;
}

interface NotifyServiceDeps {
  db: VobaseDb;
  emailProvider?: EmailProvider;
  emailProviderName?: string;
  whatsappProvider?: WhatsAppProvider;
  whatsappProviderName?: string;
}

function logNotification(
  db: VobaseDb,
  channel: string,
  provider: string,
  to: string,
  result: { success: boolean; messageId?: string; error?: string },
  extra?: { subject?: string; template?: string },
) {
  db.insert(notifyLog)
    .values({
      channel,
      provider,
      to,
      subject: extra?.subject ?? null,
      template: extra?.template ?? null,
      providerMessageId: result.messageId ?? null,
      status: result.success ? 'sent' : 'failed',
      error: result.error ?? null,
    })
    .run();
}

export function createNotifyService(deps: NotifyServiceDeps): NotifyService {
  const { db } = deps;

  const email: EmailChannel = deps.emailProvider
    ? (() => {
        const provider = deps.emailProvider;
        const providerName = deps.emailProviderName ?? 'unknown';
        return {
          async send(message) {
            const result = await provider.send(message);
            const to = Array.isArray(message.to) ? message.to.join(',') : message.to;
            logNotification(db, 'email', providerName, to, result, {
              subject: message.subject,
            });
            return result;
          },
        };
      })()
    : createThrowProxy<EmailChannel>('email notify channel');

  const whatsapp: WhatsAppChannel = deps.whatsappProvider
    ? (() => {
        const provider = deps.whatsappProvider;
        const providerName = deps.whatsappProviderName ?? 'unknown';
        return {
          async send(message) {
            const result = await provider.send(message);
            logNotification(db, 'whatsapp', providerName, message.to, result, {
              template: message.template?.name,
            });
            return result;
          },
        };
      })()
    : createThrowProxy<WhatsAppChannel>('WhatsApp notify channel');

  return { email, whatsapp };
}
