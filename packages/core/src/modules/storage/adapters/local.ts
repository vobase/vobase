import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join, normalize } from 'node:path';

import type {
  LocalAdapterConfig,
  StorageAdapter,
  StorageObjectInfo,
} from '../../../contracts/storage';
import { validation } from '../../../infra/errors';

function sanitizePath(inputPath: string): string {
  if (inputPath.includes('..')) {
    throw validation(
      { path: inputPath },
      'Invalid path: directory traversal not allowed',
    );
  }
  return normalize(inputPath).replace(/^\/+/, '');
}

export function createLocalAdapter(config: LocalAdapterConfig): StorageAdapter {
  const basePath = config.basePath;
  const baseUrl = config.baseUrl ?? '/api/storage';

  // Ensure base directory exists
  mkdirSync(basePath, { recursive: true });

  return {
    async upload(fullKey, data, opts) {
      const safe = sanitizePath(fullKey);
      const fullPath = join(basePath, safe);

      if (opts?.maxSize && data.byteLength > opts.maxSize) {
        throw validation(
          { size: data.byteLength, maxSize: opts.maxSize },
          `File size ${data.byteLength} exceeds maximum allowed size ${opts.maxSize}`,
        );
      }

      const dir = dirname(fullPath);
      mkdirSync(dir, { recursive: true });

      await Bun.write(fullPath, data);
    },

    async download(fullKey) {
      const safe = sanitizePath(fullKey);
      const file = Bun.file(join(basePath, safe));
      if (!(await file.exists())) {
        throw validation({ key: fullKey }, `File not found: ${fullKey}`);
      }
      return new Uint8Array(await file.arrayBuffer());
    },

    async delete(fullKey) {
      const safe = sanitizePath(fullKey);
      const fullPath = join(basePath, safe);
      try {
        unlinkSync(fullPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    },

    async exists(fullKey) {
      const safe = sanitizePath(fullKey);
      return existsSync(join(basePath, safe));
    },

    presign(fullKey, _opts) {
      const safe = sanitizePath(fullKey);
      // Local provider returns a proxy URL — the server handles the actual I/O
      return `${baseUrl}/${safe}`;
    },

    async list(prefix, opts) {
      const safe = sanitizePath(prefix || '');
      const dir = join(basePath, safe);
      const limit = opts?.limit ?? 100;

      const objects: StorageObjectInfo[] = [];

      if (!existsSync(dir)) {
        return { objects };
      }

      const entries = readdirSync(dir, { recursive: true });
      let skipping = !!opts?.cursor;

      for (const entry of entries) {
        const entryStr = typeof entry === 'string' ? entry : entry.toString();
        const fullPath = join(dir, entryStr);

        try {
          const stat = statSync(fullPath);
          if (!stat.isFile()) continue;
        } catch {
          continue;
        }

        const key = safe ? `${safe}/${entryStr}` : entryStr;

        if (skipping) {
          if (key === opts?.cursor) skipping = false;
          continue;
        }

        if (objects.length >= limit) {
          return { objects, cursor: objects[objects.length - 1].key };
        }

        const stat = statSync(fullPath);
        objects.push({
          key,
          size: stat.size,
          contentType: 'application/octet-stream',
          lastModified: stat.mtime,
        });
      }

      return { objects };
    },
  };
}
