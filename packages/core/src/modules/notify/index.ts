import { Hono } from 'hono';

import { defineBuiltinModule } from '../../module';
import { createResendProvider, type ResendConfig } from './providers/resend';
import { createSmtpProvider, type SmtpConfig } from './providers/smtp';
import { createWabaProvider, type WabaConfig } from './providers/waba';
import { createNotifyService, type NotifyService } from './service';
import { notifySchema } from './schema';
import type { VobaseDb } from '../../db/client';

export interface EmailNotifyConfig {
  provider: 'resend' | 'smtp';
  from: string;
  resend?: Omit<ResendConfig, 'from'>;
  smtp?: Omit<SmtpConfig, 'from'>;
}

export interface WhatsAppNotifyConfig {
  phoneNumberId: string;
  accessToken: string;
  apiVersion?: string;
}

export interface NotifyModuleConfig {
  email?: EmailNotifyConfig;
  whatsapp?: WhatsAppNotifyConfig;
}

export function createNotifyModule(db: VobaseDb, config: NotifyModuleConfig) {
  let emailProvider;
  let emailProviderName: string | undefined;

  if (config.email) {
    if (config.email.provider === 'resend') {
      if (!config.email.resend) {
        throw new Error('Resend config required when provider is "resend"');
      }
      emailProvider = createResendProvider({
        apiKey: config.email.resend.apiKey,
        from: config.email.from,
      });
      emailProviderName = 'resend';
    } else if (config.email.provider === 'smtp') {
      if (!config.email.smtp) {
        throw new Error('SMTP config required when provider is "smtp"');
      }
      emailProvider = createSmtpProvider({
        ...config.email.smtp,
        from: config.email.from,
      });
      emailProviderName = 'smtp';
    }
  }

  let whatsappProvider;
  let whatsappProviderName: string | undefined;

  if (config.whatsapp) {
    whatsappProvider = createWabaProvider({
      phoneNumberId: config.whatsapp.phoneNumberId,
      accessToken: config.whatsapp.accessToken,
      apiVersion: config.whatsapp.apiVersion,
    });
    whatsappProviderName = 'waba';
  }

  const service = createNotifyService({
    db,
    emailProvider,
    emailProviderName,
    whatsappProvider,
    whatsappProviderName,
  });

  const mod = defineBuiltinModule({
    name: '_notify',
    schema: notifySchema,
    routes: new Hono(),
  });

  return { ...mod, service };
}

export { notifyLog, notifySchema } from './schema';
export { createNotifyService } from './service';
export type { NotifyService, EmailChannel, WhatsAppChannel } from './service';
export { createResendProvider, type ResendConfig } from './providers/resend';
export { createSmtpProvider, type SmtpConfig } from './providers/smtp';
export { createWabaProvider, type WabaConfig } from './providers/waba';
