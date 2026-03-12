import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { nanoidPrimaryKey } from '../../db/helpers';

export const storageObjects = sqliteTable(
  '_storage_objects',
  {
    id: nanoidPrimaryKey(),
    bucket: text('bucket').notNull(),
    key: text('key').notNull(),
    size: integer('size').notNull(),
    contentType: text('content_type').notNull().default('application/octet-stream'),
    metadata: text('metadata'),
    uploadedBy: text('uploaded_by'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex('storage_objects_bucket_key_idx').on(table.bucket, table.key),
    index('storage_objects_bucket_idx').on(table.bucket),
    index('storage_objects_uploaded_by_idx').on(table.uploadedBy),
  ],
);

export const storageSchema = { storageObjects };
