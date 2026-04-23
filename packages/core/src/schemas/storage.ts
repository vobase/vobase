import {
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { nanoidPrimaryKey } from '../db/helpers';
import { infraPgSchema } from '../db/pg-schemas';

export const storageObjects = infraPgSchema.table(
  'storage_objects',
  {
    id: nanoidPrimaryKey(),
    bucket: text('bucket').notNull(),
    key: text('key').notNull(),
    size: integer('size').notNull(),
    contentType: text('content_type')
      .notNull()
      .default('application/octet-stream'),
    metadata: text('metadata'),
    uploadedBy: text('uploaded_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('storage_objects_bucket_key_idx').on(table.bucket, table.key),
    index('storage_objects_bucket_idx').on(table.bucket),
    index('storage_objects_uploaded_by_idx').on(table.uploadedBy),
  ],
);
