import type { Database } from 'bun:sqlite';
import { describe, expect, it, mock } from 'bun:test';

import { createAuth } from './auth';
import { createDatabase, type VobaseDb } from './db';
import { VobaseError } from './errors';
import { optionalSessionMiddleware, sessionMiddleware } from './middleware/session';

type DbWithClient = VobaseDb & { $client: Database };

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
  };
}

describe('createAuth', () => {
  it('returns a better-auth instance with handler and api', () => {
    const db = createDatabase(':memory:') as DbWithClient;
    const auth = createAuth(db);

    expect(auth).toHaveProperty('handler');
    expect(auth).toHaveProperty('api');
    expect(auth.api).toHaveProperty('getSession');

    db.$client.close();
  });
});

describe('session middleware', () => {
  it('sessionMiddleware throws unauthorized when no session exists', async () => {
    const auth = {
      api: {
        getSession: async () => null,
      },
    };
    const c = createMockContext();

    await expect(
      sessionMiddleware(auth as any)(c as any, async () => {})
    ).rejects.toBeInstanceOf(VobaseError);

    await expect(
      sessionMiddleware(auth as any)(c as any, async () => {})
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('optionalSessionMiddleware sets user to null and continues', async () => {
    const next = mock(async () => {});
    const auth = {
      api: {
        getSession: async () => null,
      },
    };
    const c = createMockContext();

    await optionalSessionMiddleware(auth as any)(c as any, next);

    expect(c.get('user')).toBeNull();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
