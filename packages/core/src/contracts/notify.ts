/**
 * Provider interfaces for the notify module. Each channel (email, WhatsApp)
 * has its own provider interface with channel-specific options.
 */
export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailResult>;
}

export interface EmailMessage {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string; // overrides default from in config
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  attachments?: EmailAttachment[];
}

export interface EmailAttachment {
  filename: string;
  content: Buffer | Uint8Array;
  contentType?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface WhatsAppProvider {
  send(message: WhatsAppMessage): Promise<WhatsAppResult>;
}

export interface WhatsAppMessage {
  to: string; // E.164 phone number
  template?: { name: string; language: string; parameters?: string[] };
  text?: string;
}

export interface WhatsAppResult {
  success: boolean;
  messageId?: string;
  error?: string;
}
