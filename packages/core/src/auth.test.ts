import { rmSync } from 'node:fs';
import { afterAll, describe, expect, it, mock } from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import type { Context, Next } from 'hono';

import type { AuthAdapter, AuthSession } from './contracts/auth';
import { createDatabase, type VobaseDb } from './db';
import { VobaseError } from './infra/errors';
import { createAuthModule } from './modules/auth';
import {
  optionalSessionMiddleware,
  sessionMiddleware,
} from './modules/auth/middleware';

type DbWithClient = VobaseDb & { $client: PGlite };

const testDb = `/tmp/vobase-test-auth-${Date.now()}`;

afterAll(() => {
  rmSync(testDb, { recursive: true, force: true });
});

function createMockContext() {
  const values = new Map<string, unknown>();

  return {
    req: {
      raw: {
        headers: new Headers(),
      },
    },
    set: (key: string, value: unknown) => {
      values.set(key, value);
    },
    get: (key: string) => values.get(key),
  } as unknown as Context;
}

function createMockAdapter(
  getSession: () => Promise<AuthSession | null>,
): AuthAdapter {
  return {
    getSession,
    handler: async () => new Response('ok'),
  };
}

describe('createAuthModule', () => {
  it('returns a module with adapter having handler and getSession', async () => {
    const db = createDatabase(testDb) as DbWithClient;
    const authMod = createAuthModule(db);

    expect(authMod).toHaveProperty('adapter');
    expect(authMod.adapter).toHaveProperty('handler');
    expect(authMod.adapter).toHaveProperty('getSession');
    expect(authMod.name).toBe('_auth');

    await db.$client.close();
  });
});

describe('session middleware', () => {
  it('sessionMiddleware throws unauthorized when no session exists', async () => {
    const adapter = createMockAdapter(async () => null);
    const c = createMockContext();

    await expect(
      sessionMiddleware(adapter)(c, async () => {}),
    ).rejects.toBeInstanceOf(VobaseError);

    await expect(
      sessionMiddleware(adapter)(c, async () => {}),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('optionalSessionMiddleware sets user to null and continues', async () => {
    const next = mock(async () => {}) as unknown as Next;
    const adapter = createMockAdapter(async () => null);
    const c = createMockContext();

    await optionalSessionMiddleware(adapter)(c, next);

    expect(c.get('user')).toBeNull();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
