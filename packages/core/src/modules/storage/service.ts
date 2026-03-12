import { eq, and } from 'drizzle-orm';

import type { VobaseDb } from '../../db/client';
import type {
  StorageProvider,
  UploadOptions,
  PresignOptions,
  ListOptions,
  StorageListResult,
} from '../../contracts/storage';
import { validation } from '../../errors';
import { storageObjects } from './schema';

export interface BucketConfig {
  access: 'public' | 'private';
  maxSize?: number;
  allowedTypes?: string[];
}

export interface StorageObject {
  id: string;
  bucket: string;
  key: string;
  size: number;
  contentType: string;
  metadata: Record<string, string> | null;
  uploadedBy: string | null;
  createdAt: Date;
}

export interface BucketHandle {
  upload(key: string, data: Buffer | Uint8Array, opts?: UploadOptions): Promise<StorageObject>;
  download(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  presign(key: string, opts?: PresignOptions): string;
  list(opts?: BucketListOptions): Promise<StorageListResult>;
  metadata(key: string): Promise<StorageObject | null>;
}

export interface BucketListOptions {
  prefix?: string;
  cursor?: string;
  limit?: number;
}

export interface StorageService {
  bucket(name: string): BucketHandle;
}

export function createStorageService(
  provider: StorageProvider,
  buckets: Record<string, BucketConfig>,
  db: VobaseDb,
): StorageService {
  const validBucketNames = new Set(Object.keys(buckets));

  function assertBucket(name: string): BucketConfig {
    if (!validBucketNames.has(name)) {
      throw validation(
        { bucket: name, available: [...validBucketNames] },
        `Unknown storage bucket "${name}". Available buckets: ${[...validBucketNames].join(', ')}`,
      );
    }
    return buckets[name];
  }

  function fullKey(bucket: string, key: string): string {
    return `${bucket}/${key}`;
  }

  return {
    bucket(name: string): BucketHandle {
      const config = assertBucket(name);

      return {
        async upload(key, data, opts) {
          const fk = fullKey(name, key);
          const contentType = opts?.contentType ?? 'application/octet-stream';

          if (config.maxSize && data.byteLength > config.maxSize) {
            throw validation(
              { size: data.byteLength, maxSize: config.maxSize },
              `File size ${data.byteLength} exceeds bucket max size ${config.maxSize}`,
            );
          }

          if (config.allowedTypes && config.allowedTypes.length > 0) {
            const allowed = config.allowedTypes.some((pattern) => {
              if (pattern.endsWith('/*')) {
                return contentType.startsWith(pattern.slice(0, -1));
              }
              return contentType === pattern;
            });
            if (!allowed) {
              throw validation(
                { contentType, allowedTypes: config.allowedTypes },
                `Content type "${contentType}" is not allowed in bucket "${name}"`,
              );
            }
          }

          await provider.upload(fk, data, { ...opts, maxSize: config.maxSize });

          // Upsert metadata in SQLite
          const existing = db
            .select()
            .from(storageObjects)
            .where(and(eq(storageObjects.bucket, name), eq(storageObjects.key, key)))
            .get();

          if (existing) {
            db.update(storageObjects)
              .set({
                size: data.byteLength,
                contentType,
                metadata: opts?.metadata ? JSON.stringify(opts.metadata) : null,
              })
              .where(eq(storageObjects.id, existing.id))
              .run();

            return {
              ...existing,
              size: data.byteLength,
              contentType,
              metadata: opts?.metadata ?? null,
              createdAt: existing.createdAt,
            };
          }

          const row = db
            .insert(storageObjects)
            .values({
              bucket: name,
              key,
              size: data.byteLength,
              contentType,
              metadata: opts?.metadata ? JSON.stringify(opts.metadata) : null,
              uploadedBy: opts?.metadata?.uploadedBy ?? null,
            })
            .returning()
            .get();

          return {
            id: row.id,
            bucket: row.bucket,
            key: row.key,
            size: row.size,
            contentType: row.contentType,
            metadata: row.metadata ? JSON.parse(row.metadata) : null,
            uploadedBy: row.uploadedBy,
            createdAt: row.createdAt,
          };
        },

        async download(key) {
          return provider.download(fullKey(name, key));
        },

        async delete(key) {
          await provider.delete(fullKey(name, key));
          db.delete(storageObjects)
            .where(and(eq(storageObjects.bucket, name), eq(storageObjects.key, key)))
            .run();
        },

        presign(key, opts) {
          return provider.presign(fullKey(name, key), opts ?? {});
        },

        async list(opts) {
          const prefix = opts?.prefix
            ? fullKey(name, opts.prefix)
            : `${name}/`;
          return provider.list(prefix, {
            cursor: opts?.cursor,
            limit: opts?.limit,
          });
        },

        async metadata(key) {
          const row = db
            .select()
            .from(storageObjects)
            .where(and(eq(storageObjects.bucket, name), eq(storageObjects.key, key)))
            .get();

          if (!row) return null;

          return {
            id: row.id,
            bucket: row.bucket,
            key: row.key,
            size: row.size,
            contentType: row.contentType,
            metadata: row.metadata ? JSON.parse(row.metadata) : null,
            uploadedBy: row.uploadedBy,
            createdAt: row.createdAt,
          };
        },
      };
    },
  };
}
