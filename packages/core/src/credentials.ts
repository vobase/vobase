import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Database } from 'bun:sqlite';

import type { VobaseDb } from './db/client';
import { credentialsTable } from './db/credentials-schema';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret)
    throw new Error(
      'BETTER_AUTH_SECRET is required for credential encryption',
    );
  return crypto.createHash('sha256').update(secret).digest();
}

/** Encrypt a plaintext string using AES-256-GCM. Returns base64-encoded ciphertext. */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/** Decrypt a base64-encoded ciphertext using AES-256-GCM. */
export function decrypt(encoded: string): string {
  const key = getEncryptionKey();
  const data = Buffer.from(encoded, 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}

/** Get a single credential value (decrypted). Returns null if not found or decryption fails. */
export async function getCredential(
  db: VobaseDb,
  key: string,
): Promise<string | null> {
  const rows = await db
    .select()
    .from(credentialsTable)
    .where(eq(credentialsTable.key, key))
    .limit(1);
  if (!rows[0]) return null;
  try {
    return decrypt(rows[0].value);
  } catch {
    return null;
  }
}

/** Set a single credential value (encrypted). Upserts on conflict. */
export async function setCredential(
  db: VobaseDb,
  key: string,
  value: string,
): Promise<void> {
  const encrypted = encrypt(value);
  await db
    .insert(credentialsTable)
    .values({ key, value: encrypted })
    .onConflictDoUpdate({
      target: credentialsTable.key,
      set: { value: encrypted, updatedAt: new Date() },
    });
}

/** Delete a single credential. */
export async function deleteCredential(
  db: VobaseDb,
  key: string,
): Promise<void> {
  await db
    .delete(credentialsTable)
    .where(eq(credentialsTable.key, key));
}

const CREDENTIALS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS _credentials (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  )
`;

/**
 * Create the _credentials table if it doesn't exist.
 * This is opt-in — call during app startup if your project uses credential encryption.
 */
export function ensureCredentialTable(db: Database): void {
  db.run(CREDENTIALS_TABLE_SQL);
}
