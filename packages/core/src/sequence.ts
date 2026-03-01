import { createNanoid, type VobaseDb } from './db';

export interface SequenceOptions {
  padLength?: number;
  separator?: string;
  yearPrefix?: boolean;
}

const generateSequenceId = createNanoid();

interface SequenceRow {
  currentValue: number;
}

export function nextSequence(db: VobaseDb, prefix: string, options?: SequenceOptions): string {
  const padLength = options?.padLength ?? 4;
  const separator = options?.separator ?? '-';
  const yearPrefix = options?.yearPrefix ?? false;
  const now = Date.now();

  const statement = db.$client.prepare(`
    INSERT INTO _sequences (id, prefix, current_value, updated_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT (prefix) DO UPDATE
    SET current_value = current_value + 1, updated_at = ?
    RETURNING current_value AS currentValue;
  `);

  const row = statement.get(generateSequenceId(), prefix, now, now) as SequenceRow | undefined;
  if (!row) {
    throw new Error(`Failed to generate next sequence for prefix: ${prefix}`);
  }

  const formattedValue = String(row.currentValue).padStart(padLength, '0');
  if (yearPrefix) {
    const year = new Date(now).getFullYear();
    return `${prefix}${separator}${year}${separator}${formattedValue}`;
  }

  return `${prefix}${separator}${formattedValue}`;
}
