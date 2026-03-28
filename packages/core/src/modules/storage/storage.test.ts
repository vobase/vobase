import { mkdirSync, rmSync } from 'node:fs';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import type { VobaseDb } from '../../db/client';
import { VobaseError } from '../../infra/errors';
import { createTestPGlite } from '../../test-helpers';
import { createLocalAdapter } from './adapters/local';
import * as storageSchemaModule from './schema';
import { type BucketConfig, createStorageService } from './service';

const testBasePath = '/tmp/vobase-test-storage-v2';

async function createTestDb(): Promise<{ db: VobaseDb; pglite: PGlite }> {
  const pglite = await createTestPGlite();
  await pglite.query(`
    CREATE TABLE "infra"."storage_objects" (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      bucket TEXT NOT NULL,
      key TEXT NOT NULL,
      size INTEGER NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      metadata TEXT,
      uploaded_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pglite.query(
    'CREATE UNIQUE INDEX storage_objects_bucket_key_idx ON "infra"."storage_objects"(bucket, key)',
  );
  const db = drizzle({
    client: pglite,
    schema: storageSchemaModule,
  }) as unknown as VobaseDb;
  return { db, pglite };
}

describe('Local Provider', () => {
  beforeAll(() => {
    try {
      rmSync(testBasePath, { recursive: true, force: true });
    } catch {}
    mkdirSync(testBasePath, { recursive: true });
  });

  afterAll(() => {
    try {
      rmSync(testBasePath, { recursive: true, force: true });
    } catch {}
  });

  it('uploads and downloads a file', async () => {
    const provider = createLocalAdapter({
      type: 'local',
      basePath: testBasePath,
    });
    const data = new Uint8Array([1, 2, 3, 4, 5]);

    await provider.upload('test-bucket/file.bin', data);
    const downloaded = await provider.download('test-bucket/file.bin');

    expect(downloaded).toEqual(data);
  });

  it('checks file existence', async () => {
    const provider = createLocalAdapter({
      type: 'local',
      basePath: testBasePath,
    });
    const data = new Uint8Array([42]);

    await provider.upload('test-bucket/exists.bin', data);

    expect(await provider.exists('test-bucket/exists.bin')).toBe(true);
    expect(await provider.exists('test-bucket/nonexistent.bin')).toBe(false);
  });

  it('deletes a file', async () => {
    const provider = createLocalAdapter({
      type: 'local',
      basePath: testBasePath,
    });
    const data = new Uint8Array([99]);

    await provider.upload('test-bucket/to-delete.bin', data);
    await provider.delete('test-bucket/to-delete.bin');

    expect(await provider.exists('test-bucket/to-delete.bin')).toBe(false);
  });

  it('rejects directory traversal', async () => {
    const provider = createLocalAdapter({
      type: 'local',
      basePath: testBasePath,
    });

    expect(() => provider.presign('../etc/passwd', {})).toThrow(VobaseError);
  });

  it('returns proxy URL from presign', () => {
    const provider = createLocalAdapter({
      type: 'local',
      basePath: testBasePath,
    });
    const url = provider.presign('avatars/user-123/pic.jpg', {});

    expect(url).toBe('/api/storage/avatars/user-123/pic.jpg');
  });

  it('enforces maxSize on upload', async () => {
    const provider = createLocalAdapter({
      type: 'local',
      basePath: testBasePath,
    });
    const largeData = new Uint8Array(1000);

    await expect(
      provider.upload('test-bucket/large.bin', largeData, { maxSize: 100 }),
    ).rejects.toThrow(VobaseError);
  });

  it('lists files in a directory', async () => {
    const listPath = `${testBasePath}/list-test`;
    rmSync(listPath, { recursive: true, force: true });
    mkdirSync(listPath, { recursive: true });

    const provider = createLocalAdapter({ type: 'local', basePath: listPath });
    await provider.upload('mybucket/a.txt', new Uint8Array([1]));
    await provider.upload('mybucket/b.txt', new Uint8Array([2, 3]));

    const result = await provider.list('mybucket');

    expect(result.objects.length).toBe(2);
    expect(result.objects.map((o) => o.key).sort()).toEqual([
      'mybucket/a.txt',
      'mybucket/b.txt',
    ]);
  });
});

describe('StorageService', () => {
  let db: VobaseDb;
  let pglite: PGlite;

  const buckets: Record<string, BucketConfig> = {
    avatars: { access: 'public', maxSize: 5 * 1024 * 1024 },
    documents: {
      access: 'private',
      allowedTypes: ['application/pdf', 'image/*'],
    },
  };

  beforeAll(async () => {
    const result = await createTestDb();
    db = result.db;
    pglite = result.pglite;
  });

  beforeEach(async () => {
    await pglite.query('DELETE FROM "infra"."storage_objects"');
    try {
      rmSync(`${testBasePath}/svc`, { recursive: true, force: true });
    } catch {}
    mkdirSync(`${testBasePath}/svc`, { recursive: true });
  });

  // Never close the shared PGlite — process exit handles cleanup

  it('throws for unknown bucket name', () => {
    const provider = createLocalAdapter({
      type: 'local',
      basePath: `${testBasePath}/svc`,
    });
    const svc = createStorageService(provider, buckets, db);

    expect(() => svc.bucket('nonexistent')).toThrow(VobaseError);
  });

  it('uploads and tracks metadata in database', async () => {
    const provider = createLocalAdapter({
      type: 'local',
      basePath: `${testBasePath}/svc`,
    });
    const svc = createStorageService(provider, buckets, db);

    const handle = svc.bucket('avatars');
    const obj = await handle.upload(
      'user-1/pic.jpg',
      new Uint8Array([1, 2, 3]),
      {
        contentType: 'image/jpeg',
      },
    );

    expect(obj.bucket).toBe('avatars');
    expect(obj.key).toBe('user-1/pic.jpg');
    expect(obj.size).toBe(3);
    expect(obj.contentType).toBe('image/jpeg');

    const meta = await handle.metadata('user-1/pic.jpg');
    expect(meta).not.toBeNull();
    expect(meta?.size).toBe(3);
  });

  it('downloads uploaded file', async () => {
    const provider = createLocalAdapter({
      type: 'local',
      basePath: `${testBasePath}/svc`,
    });
    const svc = createStorageService(provider, buckets, db);

    const data = new Uint8Array([10, 20, 30]);
    await svc.bucket('avatars').upload('dl-test.bin', data);
    const downloaded = await svc.bucket('avatars').download('dl-test.bin');

    expect(downloaded).toEqual(data);
  });

  it('deletes file and removes metadata', async () => {
    const provider = createLocalAdapter({
      type: 'local',
      basePath: `${testBasePath}/svc`,
    });
    const svc = createStorageService(provider, buckets, db);

    await svc.bucket('avatars').upload('del-test.bin', new Uint8Array([1]));
    await svc.bucket('avatars').delete('del-test.bin');

    const meta = await svc.bucket('avatars').metadata('del-test.bin');
    expect(meta).toBeNull();
  });

  it('enforces bucket maxSize', async () => {
    const provider = createLocalAdapter({
      type: 'local',
      basePath: `${testBasePath}/svc`,
    });
    const smallBuckets = { tiny: { access: 'private' as const, maxSize: 10 } };
    const svc = createStorageService(provider, smallBuckets, db);

    await expect(
      svc.bucket('tiny').upload('big.bin', new Uint8Array(100)),
    ).rejects.toThrow(VobaseError);
  });

  it('enforces allowedTypes', async () => {
    const provider = createLocalAdapter({
      type: 'local',
      basePath: `${testBasePath}/svc`,
    });
    const svc = createStorageService(provider, buckets, db);

    await svc.bucket('documents').upload('doc.pdf', new Uint8Array([1]), {
      contentType: 'application/pdf',
    });

    await svc.bucket('documents').upload('pic.png', new Uint8Array([1]), {
      contentType: 'image/png',
    });

    await expect(
      svc.bucket('documents').upload('file.txt', new Uint8Array([1]), {
        contentType: 'text/plain',
      }),
    ).rejects.toThrow(VobaseError);
  });

  it('presign returns proxy URL with bucket prefix', () => {
    const provider = createLocalAdapter({
      type: 'local',
      basePath: `${testBasePath}/svc`,
    });
    const svc = createStorageService(provider, buckets, db);

    const url = svc.bucket('avatars').presign('user-1/pic.jpg');
    expect(url).toBe('/api/storage/avatars/user-1/pic.jpg');
  });
});
