/**
 * Workspace materializers (dirty writeback) + memory distill stub.
 *
 * Acceptance criteria:
 *  1. Contact memory auto-write: pre-wake write to /workspace/contact/MEMORY.md
 *     → post-wake contacts.working_memory row updated.
 *  2. Drive write-blocking: /workspace/drive/pricing.md rejected (RO enforcer);
 *     /workspace/contact/drive/notes.md allowed.
 *  3. Proposal flow: vobase drive propose CLI → learning_proposals row status=pending.
 *  4. Distill observer: seeded wake + mock distill fn → contacts row updated.
 *  5. Frozen-snapshot: mid-wake dirty writes appear in flush() but NOT in initialSnapshot.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { MERIDIAN_AGENT_ID } from '@modules/agents/seed'
import { setDb as setLearningProposalsDb } from '@modules/agents/service/learning-proposals'
import { createContactsPort } from '@modules/contacts/port'
import { MERIDIAN_TENANT_ID, SEEDED_CONTACT_ID } from '@modules/contacts/seed'
import {
  readWorkingMemory,
  setDb as setContactsDb,
  upsertWorkingMemorySection,
} from '@modules/contacts/service/contacts'
import { setTenantId as setProposalTenantId } from '@modules/drive/service/proposal'
import { SEEDED_CONV_ID } from '@modules/inbox/seed'
import { mockStream } from '@server/harness'
import { DirtyTracker, snapshotFs } from '@server/workspace/dirty-tracker'
import { checkWriteAllowed } from '@server/workspace/ro-enforcer'
import { driveVerbs } from '@server/workspace/vobase-cli/commands/drive'
import { eq } from 'drizzle-orm'
import { InMemoryFs } from 'just-bash'
import type { TestDbHandle } from './helpers/test-db'
import { connectTestDb, resetAndSeedDb } from './helpers/test-db'
import { bootWakeIntegration, buildIntegrationPorts } from './helpers/test-harness'

// ─── DB setup ────────────────────────────────────────────────────────────────

let db: TestDbHandle

beforeAll(async () => {
  await resetAndSeedDb()
  db = connectTestDb()
  setContactsDb(db.db)
  setLearningProposalsDb(db.db)
  setProposalTenantId(MERIDIAN_TENANT_ID)
}, 60_000)

afterAll(async () => {
  await db.teardown()
})

// ─── 1. Contact memory auto-write ────────────────────────────────────────────

describe('workspaceSyncObserver', () => {
  test('contact/MEMORY.md pre-wake write → contacts.working_memory updated post-wake', async () => {
    const ports = await buildIntegrationPorts(db)
    // Real upsertWorkingMemorySection: wire real contacts service into the port
    const realContactsPort = createContactsPort()

    const { harness } = await bootWakeIntegration(
      { ...ports, contacts: realContactsPort },
      {
        tenantId: MERIDIAN_TENANT_ID,
        agentId: MERIDIAN_AGENT_ID,
        contactId: SEEDED_CONTACT_ID,
        conversationId: SEEDED_CONV_ID,
        // Pre-write contact memory with a section BEFORE the wake snapshot
        preWakeWrites: [
          {
            path: '/workspace/contact/MEMORY.md',
            content: '## Preferences\n\nprefers email communication',
          },
        ],
        mockStreamFn: mockStream([{ type: 'finish', finishReason: 'stop' }]),
      },
      db,
    )

    // workspaceSyncObserver fires on agent_end and flushes the dirty tracker.
    // /workspace/contact/MEMORY.md was pre-written → shows as 'changed' in flush().
    const agentEndSeen = harness.events.some((e) => e.type === 'agent_end')
    expect(agentEndSeen).toBe(true)

    // Verify contacts.working_memory was updated.
    const memory = await readWorkingMemory(SEEDED_CONTACT_ID)
    expect(memory).toContain('Preferences')
    expect(memory).toContain('prefers email communication')
  })
})

// ─── 2. Drive write-blocking (RO enforcer unit assertions) ───────────────────

describe('RO enforcer (unified drive rules)', () => {
  test('/workspace/drive/pricing.md → rejected with EROFS hint', () => {
    const err = checkWriteAllowed('/workspace/drive/pricing.md')
    expect(err).not.toBeNull()
    expect(err).toContain('Read-only filesystem')
    expect(err).toContain('vobase drive propose')
  })

  test('/workspace/contact/drive/notes.md → allowed (contact drive is RW)', () => {
    const err = checkWriteAllowed('/workspace/contact/drive/notes.md')
    expect(err).toBeNull()
  })

  test('/workspace/SOUL.md → rejected', () => {
    const err = checkWriteAllowed('/workspace/SOUL.md')
    expect(err).not.toBeNull()
  })

  test('/workspace/tmp/scratch.txt → allowed', () => {
    const err = checkWriteAllowed('/workspace/tmp/scratch.txt')
    expect(err).toBeNull()
  })
})

// ─── 3. Proposal flow via CLI ─────────────────────────────────────────────────

describe('vobase drive propose CLI (C4)', () => {
  test('inserting a proposal creates learning_proposals row with status=pending', async () => {
    const cmd = driveVerbs.find((v) => v.name === 'drive propose')
    expect(cmd).toBeDefined()

    const ctx = {
      tenantId: MERIDIAN_TENANT_ID,
      conversationId: SEEDED_CONV_ID,
      agentId: MERIDIAN_AGENT_ID,
      contactId: SEEDED_CONTACT_ID,
      writeWorkspace: async () => undefined,
      readWorkspace: async () => '',
    }

    const result = await cmd!.execute(
      ['--path=/pricing.md', '--body=Updated pricing for 2027', '--rationale=Staff requested update'],
      ctx,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok result')
    expect(result.content).toContain('pending')

    // Extract proposal ID from the result message and verify the DB row.
    const match = String(result.content).match(/Proposal\s+(\S+)\s+submitted/)
    expect(match).not.toBeNull()
    const proposalId = match![1]

    const { learningProposals } = await import('@modules/agents/schema')
    const rows = await db.db.select().from(learningProposals).where(eq(learningProposals.id, proposalId))
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row.status).toBe('pending')
    expect(row.scope).toBe('drive_doc')
    expect(row.target).toBe('/pricing.md')
    expect(row.body).toBe('Updated pricing for 2027')
  })

  test('missing --path flag → returns error', async () => {
    const cmd = driveVerbs.find((v) => v.name === 'drive propose')!
    const ctx = {
      tenantId: MERIDIAN_TENANT_ID,
      conversationId: SEEDED_CONV_ID,
      agentId: MERIDIAN_AGENT_ID,
      contactId: SEEDED_CONTACT_ID,
      writeWorkspace: async () => undefined,
      readWorkspace: async () => '',
    }
    const result = await cmd.execute(['--body=no path here'], ctx)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error result')
    expect(result.error).toContain('--path')
  })
})

// ─── 4. Distill observer ──────────────────────────────────────────────────────

describe('memoryDistillObserver', () => {
  test('seeded wake with assistant message → stub distill → contacts row updated', async () => {
    const ports = await buildIntegrationPorts(db)
    const realContactsPort = createContactsPort()

    // Reset working memory first so we can detect the update clearly.
    await upsertWorkingMemorySection(SEEDED_CONTACT_ID, 'Recent Interaction', '')

    const { harness } = await bootWakeIntegration(
      { ...ports, contacts: realContactsPort },
      {
        tenantId: MERIDIAN_TENANT_ID,
        agentId: MERIDIAN_AGENT_ID,
        contactId: SEEDED_CONTACT_ID,
        conversationId: SEEDED_CONV_ID,
        mockStreamFn: mockStream([
          { type: 'text-delta', delta: 'Hello! How can I help you today?' },
          { type: 'finish', finishReason: 'stop' },
        ]),
      },
      db,
    )

    const agentEndSeen = harness.events.some((e) => e.type === 'agent_end')
    expect(agentEndSeen).toBe(true)

    // The stub distill writes a "Recent Interaction" section.
    const memory = await readWorkingMemory(SEEDED_CONTACT_ID)
    expect(memory).toContain('Recent Interaction')
    expect(memory).toContain('Hello!')
  })
})

// ─── 5. Frozen-snapshot: buffer-level unit assertion ─────────────────────────

describe('DirtyTracker frozen-snapshot invariant', () => {
  test('write AFTER snapshot appears in flush() but not in initialSnapshot', async () => {
    const innerFs = new InMemoryFs()

    // Simulate eager-write zone at workspace construction.
    await innerFs.writeFile('/workspace/contact/MEMORY.md', '# Memory\n')
    await innerFs.mkdir('/workspace/contact/drive', { recursive: true })

    // Capture the initial snapshot (same as createWorkspace does).
    const initialSnapshot = await snapshotFs(innerFs)

    // Create dirty tracker — represents the frozen baseline.
    const tracker = new DirtyTracker(initialSnapshot)

    // Mid-wake write (happens AFTER snapshot, so NOT in frozen zone).
    await innerFs.writeFile('/workspace/contact/drive/notes.md', '# Notes\nfoo')
    await innerFs.writeFile('/workspace/contact/MEMORY.md', '# Memory\n## Prefs\n\nbar')

    // flush() detects the writes — they surface for the NEXT turn (agent_end).
    const scoped = await tracker.flush(innerFs)

    // New drive file: added.
    expect(scoped.contactDrive.added).toContain('/workspace/contact/drive/notes.md')
    // Modified MEMORY.md: changed.
    expect(scoped.contactMemory.changed).toContain('/workspace/contact/MEMORY.md')

    // Critically: the mid-wake write is NOT in the frozen initialSnapshot.
    expect(initialSnapshot.has('/workspace/contact/drive/notes.md')).toBe(false)
    // The MEMORY.md IS in initialSnapshot (eager-written before snapshot) but
    // with the OLD content — new content only visible via flush(), not side-load.
    expect(initialSnapshot.get('/workspace/contact/MEMORY.md')).toBe('# Memory\n')
    expect(initialSnapshot.get('/workspace/contact/MEMORY.md')).not.toContain('Prefs')
  })

  test('ScopedDiff correctly buckets paths by scope', async () => {
    const innerFs = new InMemoryFs()
    await innerFs.mkdir('/workspace/contact/drive', { recursive: true })
    await innerFs.mkdir('/workspace/tmp', { recursive: true })

    const snap = await snapshotFs(innerFs)
    const tracker = new DirtyTracker(snap)

    await innerFs.writeFile('/workspace/contact/drive/a.md', 'a')
    await innerFs.writeFile('/workspace/contact/MEMORY.md', 'b')
    await innerFs.writeFile('/workspace/MEMORY.md', 'c')
    await innerFs.writeFile('/workspace/tmp/scratch.txt', 'd')

    const diff = await tracker.flush(innerFs)

    expect(diff.contactDrive.added).toContain('/workspace/contact/drive/a.md')
    expect(diff.contactMemory.added).toContain('/workspace/contact/MEMORY.md')
    expect(diff.agentMemory.added).toContain('/workspace/MEMORY.md')
    expect(diff.tmp.added).toContain('/workspace/tmp/scratch.txt')
  })
})
