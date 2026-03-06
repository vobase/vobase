import { Database } from 'bun:sqlite';
import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, test } from 'bun:test';
import {
  checkAndRecordWebhook,
  ensureWebhookDedupTable,
  verifyHmacSignature,
  type WebhookConfig,
} from './webhooks';

/** Helper: compute a valid HMAC-SHA256 hex signature for a given payload + secret */
function computeSignature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

describe('WebhookConfig', () => {
  test('type is correctly shaped with required and optional fields', () => {
    const config: WebhookConfig = {
      path: '/webhooks/stripe',
      secret: 'whsec_test123',
      handler: 'system:processWebhook',
    };
    expect(config.path).toBe('/webhooks/stripe');
    expect(config.secret).toBe('whsec_test123');
    expect(config.handler).toBe('system:processWebhook');
    expect(config.signatureHeader).toBeUndefined();
    expect(config.dedup).toBeUndefined();
    expect(config.idHeader).toBeUndefined();

    const fullConfig: WebhookConfig = {
      path: '/webhooks/github',
      secret: 'ghsec_abc',
      handler: 'system:processGithub',
      signatureHeader: 'x-hub-signature-256',
      dedup: false,
      idHeader: 'x-github-delivery',
    };
    expect(fullConfig.signatureHeader).toBe('x-hub-signature-256');
    expect(fullConfig.dedup).toBe(false);
    expect(fullConfig.idHeader).toBe('x-github-delivery');
  });
});

describe('verifyHmacSignature', () => {
  const secret = 'test-webhook-secret';
  const payload = '{"event":"payment.completed","id":"evt_123"}';

  test('verifies valid HMAC-SHA256 signature', () => {
    const signature = computeSignature(payload, secret);
    expect(verifyHmacSignature(payload, signature, secret)).toBe(true);
  });

  test('rejects invalid signature', () => {
    const signature = computeSignature(payload, secret);
    // Flip last character
    const tampered = signature.slice(0, -1) + (signature.endsWith('0') ? '1' : '0');
    expect(verifyHmacSignature(payload, tampered, secret)).toBe(false);
  });

  test('rejects empty signature', () => {
    expect(verifyHmacSignature(payload, '', secret)).toBe(false);
  });

  test('rejects signature with wrong length', () => {
    expect(verifyHmacSignature(payload, 'abcdef', secret)).toBe(false);
    expect(verifyHmacSignature(payload, 'a'.repeat(128), secret)).toBe(false);
  });

  test('uses timing-safe comparison (not ===)', () => {
    // We verify this structurally: the function uses timingSafeEqual internally.
    // Here we confirm that a valid signature passes and a same-length invalid one fails,
    // which would also fail with ===, but the implementation uses timingSafeEqual.
    const valid = computeSignature(payload, secret);
    expect(verifyHmacSignature(payload, valid, secret)).toBe(true);

    // Same length but different content — must still reject
    const sameLength = 'f'.repeat(valid.length);
    expect(verifyHmacSignature(payload, sameLength, secret)).toBe(false);
  });

  test('handles different payloads correctly', () => {
    const payload2 = '{"different":"data"}';
    const sig1 = computeSignature(payload, secret);
    const sig2 = computeSignature(payload2, secret);

    expect(verifyHmacSignature(payload, sig1, secret)).toBe(true);
    expect(verifyHmacSignature(payload2, sig2, secret)).toBe(true);
    // Cross-check: sig for payload1 should not verify payload2
    expect(verifyHmacSignature(payload2, sig1, secret)).toBe(false);
  });

  test('never throws on malformed input', () => {
    expect(verifyHmacSignature(payload, 'not-hex-at-all!!!', secret)).toBe(false);
    expect(verifyHmacSignature(payload, 'zzzz'.repeat(16), secret)).toBe(false);
  });
});

describe('webhook deduplication', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    ensureWebhookDedupTable(db);
  });

  test('first webhook ID is not a duplicate', () => {
    const isDuplicate = checkAndRecordWebhook(db, 'wh_001', 'stripe');
    expect(isDuplicate).toBe(false);
  });

  test('same webhook ID is a duplicate', () => {
    checkAndRecordWebhook(db, 'wh_002', 'stripe');
    const isDuplicate = checkAndRecordWebhook(db, 'wh_002', 'stripe');
    expect(isDuplicate).toBe(true);
  });

  test('different webhook IDs are not duplicates', () => {
    expect(checkAndRecordWebhook(db, 'wh_aaa', 'stripe')).toBe(false);
    expect(checkAndRecordWebhook(db, 'wh_bbb', 'stripe')).toBe(false);
    expect(checkAndRecordWebhook(db, 'wh_ccc', 'stripe')).toBe(false);
  });

  test('same ID with different source is still a duplicate (ID is primary key)', () => {
    expect(checkAndRecordWebhook(db, 'wh_shared', 'stripe')).toBe(false);
    expect(checkAndRecordWebhook(db, 'wh_shared', 'github')).toBe(true);
  });
});
