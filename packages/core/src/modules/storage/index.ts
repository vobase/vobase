import { Hono } from 'hono';

import { defineBuiltinModule } from '../../module';
import { createLocalProvider } from './providers/local';
import { createS3Provider } from './providers/s3';
import { createStorageRoutes } from './routes';
import { createStorageService, type StorageService, type BucketConfig } from './service';
import { storageSchema } from './schema';
import type { StorageProviderConfig } from '../../contracts/storage';
import type { VobaseDb } from '../../db/client';

export interface StorageModuleConfig {
  provider: StorageProviderConfig;
  buckets: Record<string, BucketConfig>;
}

export function createStorageModule(db: VobaseDb, config: StorageModuleConfig) {
  let service: StorageService;

  if (config.provider.type === 'local') {
    const provider = createLocalProvider(config.provider);
    service = createStorageService(provider, config.buckets, db);
  } else if (config.provider.type === 's3') {
    const provider = createS3Provider(config.provider);
    service = createStorageService(provider, config.buckets, db);
  } else {
    throw new Error(`Unknown storage provider type`);
  }

  const routes = createStorageRoutes(service);

  const mod = defineBuiltinModule({
    name: '_storage',
    schema: storageSchema,
    routes,
  });

  return { ...mod, service };
}

export { storageObjects, storageSchema } from './schema';
export { createStorageService } from './service';
export type { StorageService, BucketConfig, BucketHandle, StorageObject, BucketListOptions } from './service';
export { createLocalProvider } from './providers/local';
export { createS3Provider } from './providers/s3';
export { createStorageRoutes } from './routes';
