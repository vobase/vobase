import type { EmailProvider, EmailMessage, EmailResult } from '../../../contracts/notify';

export interface ResendConfig {
  apiKey: string;
  from: string;
}

export function createResendProvider(config: ResendConfig): EmailProvider {
  return {
    async send(message: EmailMessage): Promise<EmailResult> {
      const to = Array.isArray(message.to) ? message.to : [message.to];

      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: message.from ?? config.from,
            to,
            subject: message.subject,
            html: message.html,
            text: message.text,
            cc: message.cc,
            bcc: message.bcc,
            reply_to: message.replyTo,
          }),
        });

        if (!response.ok) {
          const body = await response.text();
          return { success: false, error: `Resend API error (${response.status}): ${body}` };
        }

        const data = (await response.json()) as { id?: string };
        return { success: true, messageId: data.id };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
