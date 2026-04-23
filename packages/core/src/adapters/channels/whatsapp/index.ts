export { createWhatsAppAdapter } from './adapter';
export { WhatsAppApiError } from './types';
export type {
  CreateTemplateInput,
  WhatsAppChannelConfig,
  WhatsAppCtaUrlInteractive,
  WhatsAppTemplate,
  WhatsAppTransportConfig,
} from './types';
// Test-only re-exports
export { _chunkText, _ERROR_CODE_MAP } from './adapter';
