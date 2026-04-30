/**
 * Workspace factory — creates a virtual filesystem + CLI for an agent wake.
 *
 * Pre-populates the FS with materialized files from the DB, registers the
 * vobase command, and provides dirty-file tracking for post-wake sync.
 */
import { createTool } from '@mastra/core/tools'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { kbChunks, kbDocuments } from '../../../knowledge-base/schema'
import { workspaceFiles } from '../../schema'
import { buildRegistry, createVobaseCommand } from './commands'
import { bookingCommands } from './commands/booking'
import { conversationCommands } from './commands/conversation'
import { queryCommands } from './commands/query'
import type { WakeContext } from './commands/types'
import { materializeMessages } from './materialize-messages'
import {
  loadWorkspaceFile,
  materializeBookings,
  materializeProfile,
  materializeRelevant,
  materializeState,
} from './materializers'

/** Convert a document title to a filesystem-safe slug. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Create an agent workspace: virtual FS + bash instance + dirty-file tracking.
 *
 * Returns the bash instance and a function to get modified files for DB sync.
 */
export async function createWorkspace(ctx: WakeContext, onSideEffect?: () => void) {
  const { Bash, InMemoryFs } = await import('just-bash')
  const fs = new InMemoryFs()
  const { db, contactId, conversationId, agentId } = ctx

  // Pre-populate agent-scoped config files (AGENTS.md, SOUL.md) from workspaceFiles table
  const globalFiles = await db
    .select({ path: workspaceFiles.path, content: workspaceFiles.content })
    .from(workspaceFiles)
    .where(and(eq(workspaceFiles.agentId, agentId), isNull(workspaceFiles.contactId)))

  for (const file of globalFiles) {
    await fs.writeFile(`/workspace/${file.path}`, file.content)
  }

  // Materialize per-contact/conversation files in parallel
  const [messagesContent, stateContent, profileContent, notesContent] = await Promise.all([
    materializeMessages(db, conversationId),
    materializeState(db, conversationId),
    materializeProfile(db, contactId),
    loadWorkspaceFile(db, agentId, contactId, 'contact/notes.md'),
  ])

  await fs.writeFile('/workspace/conversation/messages.md', messagesContent)
  await fs.writeFile('/workspace/conversation/state.md', stateContent)
  await fs.writeFile('/workspace/contact/profile.md', profileContent)
  await fs.writeFile('/workspace/contact/notes.md', notesContent ?? '---\n---\n\n# Notes\n')

  // Snapshot eagerly-loaded files BEFORE registering lazy files
  // (reading lazy files would trigger their DB queries, defeating lazy loading)
  const initialSnapshot = new Map<string, string>()
  for (const path of fs.getAllPaths()) {
    const stat = await fs.stat(path)
    if (stat.isFile) {
      const content = await fs.readFile(path)
      initialSnapshot.set(path, content)
    }
  }

  // Lazy-load bookings and relevant KB (only fetched if agent reads them)
  const lazyPaths = new Set(['/workspace/contact/bookings.md', '/workspace/knowledge/relevant.md'])
  fs.writeFileLazy('/workspace/contact/bookings.md', async () => {
    return materializeBookings(db, contactId)
  })
  fs.writeFileLazy('/workspace/knowledge/relevant.md', async () => {
    return materializeRelevant(db, conversationId)
  })

  // Mount KB documents as lazy files in knowledge/ directory (ChromaFs pattern)
  // Path tree loaded eagerly (lightweight), content loaded on demand
  const kbDocs = await db
    .select({
      id: kbDocuments.id,
      title: kbDocuments.title,
      folder: kbDocuments.folder,
      chunkCount: kbDocuments.chunkCount,
    })
    .from(kbDocuments)
    .where(eq(kbDocuments.status, 'ready'))

  if (kbDocs.length > 0) {
    // Build knowledge index manifest (agent can `cat knowledge/.index` to see available docs)
    const indexLines = kbDocs.map((doc) => {
      const docPath = doc.folder ? `${doc.folder}/${slugify(doc.title)}.md` : `${slugify(doc.title)}.md`
      return `${docPath}  (${doc.chunkCount} chunks)`
    })
    await fs.writeFile(
      '/workspace/knowledge/.index',
      `# Knowledge Base\n\n${indexLines.join('\n')}\n\nUse \`cat /workspace/knowledge/<path>\` to read a document.\nUse \`vobase search-kb <query>\` for semantic search across all documents.\n`,
    )

    // Register each doc as lazy file
    for (const doc of kbDocs) {
      const slug = slugify(doc.title)
      const docPath = doc.folder ? `/workspace/knowledge/${doc.folder}/${slug}.md` : `/workspace/knowledge/${slug}.md`

      lazyPaths.add(docPath)
      fs.writeFileLazy(docPath, async () => {
        // Reassemble chunks in order (ChromaFs cat pattern)
        const chunks = await db
          .select({ content: kbChunks.content })
          .from(kbChunks)
          .where(eq(kbChunks.documentId, doc.id))
          .orderBy(asc(kbChunks.chunkIndex))
        return `# ${doc.title}\n\n${chunks.map((c) => c.content).join('\n\n')}`
      })
    }
  }

  // Build command registry and bash instance
  const registry = buildRegistry(conversationCommands, bookingCommands, queryCommands)
  const vobaseCmd = createVobaseCommand(ctx, registry, onSideEffect)
  const bash = new Bash({ fs, customCommands: [vobaseCmd] })

  return {
    bash,
    fs,

    /** Get files modified or created during the agent's run. */
    getDirtyFiles: async (): Promise<Array<{ path: string; content: string }>> => {
      const dirty: Array<{ path: string; content: string }> = []
      for (const path of fs.getAllPaths()) {
        // Only track files within the workspace directory
        if (!path.startsWith('/workspace/')) continue
        // Skip lazy files that were never read (still in lazy state)
        if (lazyPaths.has(path) && !initialSnapshot.has(path)) {
          // Only check if the agent actually read/wrote this path
          const exists = await fs.exists(path)
          if (!exists) continue
        }
        const stat = await fs.stat(path)
        if (!stat.isFile) continue
        const content = await fs.readFile(path)
        const original = initialSnapshot.get(path)
        if (original === undefined || original !== content) {
          const relativePath = path.startsWith('/workspace/') ? path.slice('/workspace/'.length) : path
          dirty.push({ path: relativePath, content })
        }
      }
      return dirty
    },
  }
}

/**
 * Wrap a just-bash Bash instance as a single Mastra tool.
 * This is the only tool the agent needs.
 */
export function createMastraBashTool(bashInstance: {
  exec: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>
}) {
  return createTool({
    id: 'bash',
    description:
      'Run bash commands in the workspace. Read files with cat, write with echo/tee, run vobase commands for actions. Run `ls /workspace/` to see the layout or `vobase help` for commands.',
    inputSchema: z.object({
      command: z
        .string()
        .describe('The bash command to run (e.g. "cat /workspace/conversation/messages.md" or "vobase reply Hello!")'),
    }),
    execute: async ({ command }) => {
      const result = await bashInstance.exec(command)
      const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
      return output || '(no output)'
    },
  })
}
