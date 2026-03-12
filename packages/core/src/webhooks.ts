import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { VobaseDb } from './db/client';
import type { Scheduler } from './queue';
import { webhookDedup } from './webhooks-schema';

export { webhookDedup } from './webhooks-schema';

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

/**
 * Check whether a webhook has already been processed and record it if not.
 *
 * Checks for existing record first, then inserts if not found.
 *
 * @returns `true` if the webhook is a duplicate, `false` if it's new.
 */
export function checkAndRecordWebhook(
  db: VobaseDb,
  webhookId: string,
  source: string,
): boolean {
  const existing = db
    .select({ id: webhookDedup.id })
    .from(webhookDedup)
    .where(and(eq(webhookDedup.id, webhookId), eq(webhookDedup.source, source)))
    .get();

  if (existing) {
    return true;
  }

  db.insert(webhookDedup)
    .values({
      id: webhookId,
      source,
      receivedAt: new Date(),
    })
    .run();

  return false;
}

/**
 * Create a Hono router that handles incoming webhook POST requests.
 *
 * For each webhook config, registers a POST handler that:
 * 1. Verifies HMAC signature
 * 2. Optionally deduplicates by webhook ID
 * 3. Enqueues the payload to the configured job
 */
export function createWebhookRoutes(
  configs: Record<string, WebhookConfig>,
  deps: { db: VobaseDb; scheduler: Scheduler },
): Hono {
  const { db, scheduler } = deps;

  const router = new Hono();

  for (const [source, config] of Object.entries(configs)) {
    router.post(config.path, async (c) => {
      const body = await c.req.text();

      const sigHeader = config.signatureHeader ?? 'x-webhook-signature';
      const signature = c.req.header(sigHeader) ?? '';

      if (!verifyHmacSignature(body, signature, config.secret)) {
        return c.json({ error: 'Invalid signature' }, 401);
      }

      const dedupEnabled = config.dedup !== false;

      if (dedupEnabled) {
        const idHeader = config.idHeader ?? 'x-webhook-id';
        const webhookId = c.req.header(idHeader) ?? '';

        if (webhookId && checkAndRecordWebhook(db, webhookId, source)) {
          return c.json({ received: true, deduplicated: true }, 200);
        }
      }

      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        payload = body;
      }

      await scheduler.add(config.handler, {
        source,
        webhookId: c.req.header(config.idHeader ?? 'x-webhook-id') ?? '',
        payload,
      });

      return c.json({ received: true }, 200);
    });
  }

  return router;
}
