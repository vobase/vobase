import { text } from 'drizzle-orm/sqlite-core';
import { customAlphabet } from 'nanoid';

const createNanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);

export const nanoidPrimaryKey = () =>
  text('id').primaryKey().$defaultFn(() => createNanoid());
