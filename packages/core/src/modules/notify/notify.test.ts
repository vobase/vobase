import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import type { VobaseDb } from '../../db/client';
import type { EmailProvider, EmailMessage, EmailResult } from '../../contracts/notify';
import { createNotifyService } from './service';
import { createResendProvider } from './providers/resend';
import * as notifySchemaModule from './schema';

function createTestDb(): { db: VobaseDb; sqlite: Database } {
  const sqlite = new Database(':memory:');
  sqlite.run('PRAGMA journal_mode=WAL');
  sqlite.exec(`
    CREATE TABLE _notify_log (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      provider TEXT NOT NULL,
      "to" TEXT NOT NULL,
      subject TEXT,
      template TEXT,
      provider_message_id TEXT,
      status TEXT NOT NULL DEFAULT 'sent',
      error TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  const db = drizzle({ client: sqlite, schema: notifySchemaModule }) as unknown as VobaseDb;
  return { db, sqlite };
}

function createMockEmailProvider(result: EmailResult): EmailProvider {
  return {
    async send(_message: EmailMessage) {
      return result;
    },
  };
}

describe('NotifyService', () => {
  let db: VobaseDb;
  let sqlite: Database;

  beforeEach(() => {
    const result = createTestDb();
    db = result.db;
    sqlite = result.sqlite;
  });

  afterEach(() => {
    sqlite.close();
  });

  it('sends email and logs success', async () => {
    const provider = createMockEmailProvider({ success: true, messageId: 'msg-123' });
    const svc = createNotifyService({
      db,
      emailProvider: provider,
      emailProviderName: 'resend',
    });

    const result = await svc.email.send({
      to: 'user@test.com',
      subject: 'Test',
      text: 'Hello',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('msg-123');

    const rows = sqlite.prepare('SELECT * FROM _notify_log').all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].channel).toBe('email');
    expect(rows[0].provider).toBe('resend');
    expect(rows[0].to).toBe('user@test.com');
    expect(rows[0].subject).toBe('Test');
    expect(rows[0].status).toBe('sent');
    expect(rows[0].provider_message_id).toBe('msg-123');
  });

  it('logs failure when email send fails', async () => {
    const provider = createMockEmailProvider({ success: false, error: 'API error' });
    const svc = createNotifyService({
      db,
      emailProvider: provider,
      emailProviderName: 'resend',
    });

    const result = await svc.email.send({
      to: 'user@test.com',
      subject: 'Fail test',
      text: 'Hello',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('API error');

    const rows = sqlite.prepare('SELECT * FROM _notify_log').all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('failed');
    expect(rows[0].error).toBe('API error');
  });

  it('throws when accessing unconfigured whatsapp channel', () => {
    const svc = createNotifyService({
      db,
      emailProvider: createMockEmailProvider({ success: true }),
      emailProviderName: 'resend',
    });

    expect(() => svc.whatsapp.send).toThrow();
  });

  it('throws when accessing unconfigured email channel', () => {
    const svc = createNotifyService({ db });

    expect(() => svc.email.send).toThrow();
  });

  it('handles multiple recipients', async () => {
    const provider = createMockEmailProvider({ success: true, messageId: 'multi-123' });
    const svc = createNotifyService({
      db,
      emailProvider: provider,
      emailProviderName: 'resend',
    });

    await svc.email.send({
      to: ['a@test.com', 'b@test.com'],
      subject: 'Multi',
      text: 'Hello all',
    });

    const rows = sqlite.prepare('SELECT "to" FROM _notify_log').all() as Array<Record<string, unknown>>;
    expect(rows[0].to).toBe('a@test.com,b@test.com');
  });
});

describe('Resend Provider', () => {
  it('returns a provider with send method', () => {
    const provider = createResendProvider({ apiKey: 'test-key', from: 'test@test.com' });
    expect(provider).toHaveProperty('send');
    expect(typeof provider.send).toBe('function');
  });
});
