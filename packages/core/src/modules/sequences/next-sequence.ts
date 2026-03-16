import { sql } from 'drizzle-orm';

import { createNanoid } from '../../db/helpers';
import type { VobaseDb } from '../../db/client';
import { sequences } from './schema';

export interface SequenceOptions {
  padLength?: number;
  separator?: string;
  yearPrefix?: boolean;
}

const generateSequenceId = createNanoid();

export function nextSequence(
  db: VobaseDb,
  prefix: string,
  options?: SequenceOptions,
): string {
  const padLength = options?.padLength ?? 4;
  const separator = options?.separator ?? '-';
  const yearPrefix = options?.yearPrefix ?? false;
  const now = new Date();

  const row = db
    .insert(sequences)
    .values({
      id: generateSequenceId(),
      prefix,
      currentValue: 1,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: sequences.prefix,
      set: {
        currentValue: sql`${sequences.currentValue} + 1`,
        updatedAt: now,
      },
    })
    .returning({ currentValue: sequences.currentValue })
    .get();

  if (!row) {
    throw new Error(`Failed to generate next sequence for prefix: ${prefix}`);
  }

  const formattedValue = String(row.currentValue).padStart(padLength, '0');
  if (yearPrefix) {
    const year = now.getFullYear();
    return `${prefix}${separator}${year}${separator}${formattedValue}`;
  }

  return `${prefix}${separator}${formattedValue}`;
}
