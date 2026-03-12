import type { EmailProvider, EmailMessage, EmailResult } from '../../../contracts/notify';

export interface SmtpConfig {
  host: string;
  port: number;
  secure?: boolean;
  auth?: { user: string; pass: string };
  from: string;
}

/**
 * Minimal SMTP email provider using Bun's TCP socket.
 * Handles basic SMTP conversation (EHLO, AUTH, MAIL FROM, RCPT TO, DATA, QUIT).
 * For production use with complex SMTP requirements, consider a dedicated library.
 */
export function createSmtpProvider(config: SmtpConfig): EmailProvider {
  async function sendSmtp(message: EmailMessage): Promise<EmailResult> {
    const to = Array.isArray(message.to) ? message.to : [message.to];
    const from = message.from ?? config.from;

    try {
      const socket = await Bun.connect({
        hostname: config.host,
        port: config.port,
        tls: config.secure ?? config.port === 465,
        socket: {
          data(_socket, data) {
            responses.push(new TextDecoder().decode(data));
          },
          open() {},
          close() {},
          error(_socket, err) {
            lastError = err;
          },
        },
      });

      const responses: string[] = [];
      let lastError: Error | undefined;

      const send = (cmd: string) => {
        socket.write(new TextEncoder().encode(`${cmd}\r\n`));
      };

      const wait = (ms = 500) => new Promise<void>((r) => setTimeout(r, ms));

      // Wait for greeting
      await wait(300);

      send(`EHLO localhost`);
      await wait(200);

      // AUTH if configured
      if (config.auth) {
        const credentials = Buffer.from(`\0${config.auth.user}\0${config.auth.pass}`).toString('base64');
        send(`AUTH PLAIN ${credentials}`);
        await wait(200);
      }

      send(`MAIL FROM:<${from}>`);
      await wait(100);

      for (const recipient of to) {
        send(`RCPT TO:<${recipient}>`);
        await wait(100);
      }

      send('DATA');
      await wait(100);

      // Build email headers and body
      const headers = [
        `From: ${from}`,
        `To: ${to.join(', ')}`,
        `Subject: ${message.subject}`,
        `Date: ${new Date().toUTCString()}`,
        `MIME-Version: 1.0`,
      ];

      if (message.cc?.length) {
        headers.push(`Cc: ${message.cc.join(', ')}`);
      }

      if (message.replyTo) {
        headers.push(`Reply-To: ${message.replyTo}`);
      }

      if (message.html) {
        headers.push('Content-Type: text/html; charset=utf-8');
        send(`${headers.join('\r\n')}\r\n\r\n${message.html}\r\n.`);
      } else {
        headers.push('Content-Type: text/plain; charset=utf-8');
        send(`${headers.join('\r\n')}\r\n\r\n${message.text ?? ''}\r\n.`);
      }

      await wait(200);

      send('QUIT');
      await wait(100);

      socket.end();

      if (lastError) {
        return { success: false, error: lastError.message };
      }

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return { send: sendSmtp };
}
