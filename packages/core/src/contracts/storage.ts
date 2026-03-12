/**
 * Provider interface for storage backends. Each provider implements
 * the physical operations; the storage module handles bucket resolution,
 * metadata tracking, and access control on top.
 */
export interface StorageProvider {
  upload(fullKey: string, data: Buffer | Uint8Array, opts?: UploadOptions): Promise<void>;
  download(fullKey: string): Promise<Uint8Array>;
  delete(fullKey: string): Promise<void>;
  exists(fullKey: string): Promise<boolean>;
  presign(fullKey: string, opts: PresignOptions): string;
  list(prefix: string, opts?: ListOptions): Promise<StorageListResult>;
}

export interface UploadOptions {
  contentType?: string;
  metadata?: Record<string, string>;
  /** Max upload size in bytes. Enforced server-side for direct uploads. */
  maxSize?: number;
}

export interface PresignOptions {
  expiresIn?: number; // seconds, default 3600
  method?: 'GET' | 'PUT'; // default 'GET'
}

export interface ListOptions {
  cursor?: string;
  limit?: number; // default 100
}

export interface StorageListResult {
  objects: StorageObjectInfo[];
  cursor?: string; // undefined = no more results
}

export interface StorageObjectInfo {
  key: string;
  size: number;
  contentType: string;
  lastModified: Date;
}

/** Local filesystem provider */
export interface LocalProviderConfig {
  type: 'local';
  basePath: string; // e.g. './data/files'
  baseUrl?: string; // for presign proxy URLs, default '/api/storage'
}

/** S3-compatible provider (AWS, R2, MinIO) using Bun native S3 */
export interface S3ProviderConfig {
  type: 's3';
  bucket: string;
  region?: string;
  endpoint?: string; // for R2, MinIO
  accessKeyId: string;
  secretAccessKey: string;
}

export type StorageProviderConfig = LocalProviderConfig | S3ProviderConfig;
