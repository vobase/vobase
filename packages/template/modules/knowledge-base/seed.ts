import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import type { VobaseDb } from '@vobase/core';
import { kbDocuments } from './schema';

const FIXTURES_DIR = join(import.meta.dir, 'lib', '__fixtures__');

const mimeMap: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.html': 'text/html',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

function getFixtureFiles(): Array<{ name: string; path: string; mime: string }> {
  return readdirSync(FIXTURES_DIR)
    .filter(f => !f.startsWith('.'))
    .map(f => {
      const ext = f.slice(f.lastIndexOf('.'));
      return { name: f, path: join(FIXTURES_DIR, f), mime: mimeMap[ext] ?? 'application/octet-stream' };
    });
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

/**
 * Seed KB documents by uploading fixture files via the app's API.
 * The app's createApp() starts a worker that processes jobs automatically.
 * We wait for all documents to finish processing before returning.
 */
export async function seedKnowledgeBase(
  app: { request: (url: string, init?: RequestInit) => Response | Promise<Response> },
  sessionCookie: string,
  db: VobaseDb,
): Promise<number> {
  const existing = db.select().from(kbDocuments).limit(1).all();
  if (existing.length > 0) return 0;

  const fixtures = getFixtureFiles();
  let uploaded = 0;

  for (const fixture of fixtures) {
    const fileBytes = readFileSync(fixture.path);
    const file = new File([fileBytes], fixture.name, { type: fixture.mime });
    const form = new FormData();
    form.append('file', file);

    const res = await app.request('http://localhost/api/knowledge-base/documents', {
      method: 'POST',
      headers: { cookie: sessionCookie },
      body: form,
    });

    if (res.ok) {
      uploaded++;
    } else {
      const err = await res.text().catch(() => '');
      console.log(yellow(`  Failed to upload ${fixture.name}: ${res.status} ${err}`));
    }
  }

  if (uploaded === 0) return 0;

  // Wait for the job worker to process all documents (max 60s)
  console.log(dim(`  Waiting for ${uploaded} documents to process...`));
  const maxWait = 60_000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const pending = db.all<{ cnt: number }>(
      sql`SELECT COUNT(*) as cnt FROM kb_documents WHERE status IN ('pending', 'processing')`,
    );
    if ((pending[0]?.cnt ?? 0) === 0) break;
    await new Promise(r => setTimeout(r, 500));
  }

  // Report results
  const docs = db.select().from(kbDocuments).all();
  for (const doc of docs) {
    const status = doc.status === 'ready'
      ? `${doc.chunkCount} chunks`
      : doc.status;
    console.log(dim(`  ${doc.title}: ${status}`));
  }

  return uploaded;
}
