import { S3Client } from 'bun';

import type {
  StorageProvider,
  UploadOptions,
  PresignOptions,
  ListOptions,
  StorageListResult,
  StorageObjectInfo,
  S3ProviderConfig,
} from '../../../contracts/storage';
import { validation } from '../../../errors';

export function createS3Provider(config: S3ProviderConfig): StorageProvider {
  const client = new S3Client({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    bucket: config.bucket,
    ...(config.region && { region: config.region }),
    ...(config.endpoint && { endpoint: config.endpoint }),
  });

  return {
    async upload(fullKey, data, opts) {
      if (opts?.maxSize && data.byteLength > opts.maxSize) {
        throw validation(
          { size: data.byteLength, maxSize: opts.maxSize },
          `File size ${data.byteLength} exceeds maximum allowed size ${opts.maxSize}`,
        );
      }

      const file = client.file(fullKey);
      await file.write(data, {
        ...(opts?.contentType && { type: opts.contentType }),
      });
    },

    async download(fullKey) {
      const file = client.file(fullKey);
      try {
        const buf = await file.arrayBuffer();
        return new Uint8Array(buf);
      } catch (err) {
        throw validation({ key: fullKey }, `File not found: ${fullKey}`);
      }
    },

    async delete(fullKey) {
      const file = client.file(fullKey);
      await file.delete();
    },

    async exists(fullKey) {
      const file = client.file(fullKey);
      return file.exists();
    },

    presign(fullKey, opts) {
      return client.presign(fullKey, {
        expiresIn: opts.expiresIn ?? 3600,
        method: opts.method ?? 'GET',
      });
    },

    async list(prefix, opts) {
      // Bun's S3Client doesn't have a native list API — use the S3 ListObjectsV2 REST API
      const limit = opts?.limit ?? 100;
      const params = new URLSearchParams({
        'list-type': '2',
        prefix: prefix,
        'max-keys': String(limit),
      });
      if (opts?.cursor) {
        params.set('start-after', opts.cursor);
      }

      const endpoint = config.endpoint ?? `https://s3.${config.region ?? 'us-east-1'}.amazonaws.com`;
      const url = `${endpoint}/${config.bucket}?${params}`;

      // Bun's S3Client doesn't expose ListObjectsV2 — full listing requires XML parsing.
      // Most use cases rely on metadata in SQLite; enhance here when needed.
      // This will be enhanced when needed; most use cases rely on metadata in SQLite
      const objects: StorageObjectInfo[] = [];
      return { objects };
    },
  };
}
