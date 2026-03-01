import { mkdirSync, unlinkSync } from 'node:fs';
import { join, normalize } from 'node:path';

import { validation } from './errors';

function sanitizePath(inputPath: string): string {
  if (inputPath.includes('..')) {
    throw validation(
      { path: inputPath },
      'Invalid path: directory traversal not allowed',
    );
  }
  // Remove leading slashes and normalize
  const normalized = normalize(inputPath).replace(/^\/+/, '');
  return normalized;
}

export interface Storage {
  upload(path: string, buffer: Buffer | Uint8Array): Promise<void>;
  download(path: string): Promise<Uint8Array>;
  getUrl(path: string): string;
  delete(path: string): Promise<void>;
}

export function createStorage(basePath: string, db?: unknown): Storage {
  return {
    async upload(path, buffer) {
      const safe = sanitizePath(path);
      const fullPath = join(basePath, safe);

      // Ensure directory exists
      const dirPath = fullPath.split('/').slice(0, -1).join('/');
      if (dirPath) {
        mkdirSync(dirPath, { recursive: true });
      }

      await Bun.write(fullPath, buffer);

      if (db) {
        // Placeholder for audit logging
      }
    },

    async download(path) {
      const safe = sanitizePath(path);
      const file = Bun.file(join(basePath, safe));
      return new Uint8Array(await file.arrayBuffer());
    },

    getUrl(path) {
      const safe = sanitizePath(path);
      return `/data/files/${safe}`;
    },

    async delete(path) {
      const safe = sanitizePath(path);
      const fullPath = join(basePath, safe);
      unlinkSync(fullPath);

      if (db) {
        // Placeholder for audit logging
      }
    },
  };
}
