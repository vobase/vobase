import { createHmac, timingSafeEqual } from 'node:crypto';

export interface WebhookConfig {
  /** Route path, e.g. '/webhooks/stripe' */
  path: string;
  /** HMAC secret for signature verification */
  secret: string;
  /** Job name to enqueue, e.g. 'system:processWebhook' */
  handler: string;
  /** Header containing the signature (default: 'x-webhook-signature') */
  signatureHeader?: string;
  /** Whether to deduplicate webhooks (default: true) */
  dedup?: boolean;
  /** Header containing the webhook delivery ID (default: 'x-webhook-id') */
  idHeader?: string;
}

/**
 * Verify an HMAC-SHA256 signature against a payload and secret.
 *
 * Uses timing-safe comparison to prevent timing attacks.
 * Returns false for any malformed or invalid signature (never throws).
 */
export function verifyHmacSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  try {
    const expected = createHmac('sha256', secret).update(payload).digest('hex');

    if (signature.length !== expected.length) {
      return false;
    }

    const sigBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');

    // If the hex decode produced different lengths (malformed hex), reject
    if (sigBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(sigBuffer, expectedBuffer);
  } catch {
    return false;
  }
}
