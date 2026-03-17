import type { StorageAdapterConfig } from '../../contracts/storage';
import type { VobaseDb } from '../../db/client';
import { defineBuiltinModule } from '../../module';
import { createLocalAdapter } from './adapters/local';
import { createS3Adapter } from './adapters/s3';
import { createStorageRoutes } from './routes';
import { storageSchema } from './schema';
import {
  type BucketConfig,
  createStorageService,
  type StorageService,
} from './service';

export interface StorageModuleConfig {
  provider: StorageAdapterConfig;
  buckets: Record<string, BucketConfig>;
}

export function createStorageModule(db: VobaseDb, config: StorageModuleConfig) {
  let service: StorageService;

  if (config.provider.type === 'local') {
    const provider = createLocalAdapter(config.provider);
    service = createStorageService(provider, config.buckets, db);
  } else if (config.provider.type === 's3') {
    const provider = createS3Adapter(config.provider);
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

export { createLocalAdapter } from './adapters/local';
export { createS3Adapter } from './adapters/s3';
export { createStorageRoutes } from './routes';
export { storageObjects, storageSchema } from './schema';
export type {
  BucketConfig,
  BucketHandle,
  BucketListOptions,
  StorageObject,
  StorageService,
} from './service';
export { createStorageService } from './service';
