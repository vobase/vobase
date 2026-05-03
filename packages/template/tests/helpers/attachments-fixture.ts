/**
 * Shared boot for the messaging-attachments e2e suite (Commit 2 / Step 12).
 *
 * Plumbs the drive runtime (storage + jobs scheduler) and the messaging
 * services (`conversations`, `messages`, `contacts`) against a real
 * Postgres seed plus a per-test temp-dir local-filesystem storage adapter
 * so attachment ingestion exercises the same `ingestUpload` code path
 * production runs.
 *
 * Each test calls `bootMessagingAttachments()` from `beforeAll` and the
 * returned `teardown` from `afterAll`; the cross-process db-reset mutex
 * in `test-db.ts` keeps `bun test` workers from racing the schema reset.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  __resetContactsServiceForTests,
  createContactsService,
  installContactsService,
} from '@modules/contacts/service/contacts'
import { __resetFilesDbForTests, setFilesRuntime } from '@modules/drive/service/files'
import {
  __resetConversationsServiceForTests,
  createConversationsService,
  installConversationsService,
} from '@modules/messaging/service/conversations'
import { __resetDriveAttachmentsDbForTests, setDriveAttachmentsDb } from '@modules/messaging/service/drive-attachments'
import {
  __resetMessagesServiceForTests,
  createMessagesService,
  installMessagesService,
} from '@modules/messaging/service/messages'
import { setJournalDb } from '@vobase/core'

import { type AppStorage, createStorage } from '~/runtime/storage'
import { connectTestDb, resetAndSeedDb, type TestDbHandle } from './test-db'

export interface AttachmentJobsCapture {
  sent: Array<{ name: string; data: Record<string, unknown>; opts?: { singletonKey?: string } }>
  send(name: string, data: Record<string, unknown>, opts?: { singletonKey?: string }): Promise<string>
}

export interface AttachmentTestHandle {
  db: TestDbHandle
  storage: AppStorage
  storageDir: string
  jobs: AttachmentJobsCapture
  teardown(): Promise<void>
}

function makeJobsCapture(): AttachmentJobsCapture {
  const sent: AttachmentJobsCapture['sent'] = []
  return {
    sent,
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async send(name, data, opts) {
      sent.push({ name, data, opts })
      return `job-${sent.length}`
    },
  }
}

export async function bootMessagingAttachments(): Promise<AttachmentTestHandle> {
  await resetAndSeedDb()
  const db = connectTestDb()
  const storageDir = mkdtempSync(join(tmpdir(), 'vobase-msg-attach-'))
  const storage = createStorage({ STORAGE_BASE_PATH: storageDir })
  const jobs = makeJobsCapture()

  setFilesRuntime(db.db, null, storage, jobs, null)
  installContactsService(
    createContactsService({ db: db.db, realtime: { notify: () => {}, subscribe: () => () => {} } }),
  )
  installConversationsService(createConversationsService({ db: db.db, scheduler: null }))
  installMessagesService(createMessagesService({ db: db.db }))
  setDriveAttachmentsDb(db.db)
  setJournalDb(db.db)

  return {
    db,
    storage,
    storageDir,
    jobs,
    async teardown() {
      __resetConversationsServiceForTests()
      __resetMessagesServiceForTests()
      __resetContactsServiceForTests()
      __resetFilesDbForTests()
      __resetDriveAttachmentsDbForTests()
      await db.teardown()
      try {
        rmSync(storageDir, { recursive: true, force: true })
      } catch {
        // best-effort cleanup
      }
    },
  }
}
