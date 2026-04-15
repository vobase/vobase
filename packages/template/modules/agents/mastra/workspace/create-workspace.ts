/**
 * Workspace factory — creates a virtual filesystem + CLI for an agent wake.
 *
 * Pre-populates the FS with materialized files from the DB, registers the
 * vobase command, and provides dirty-file tracking for post-wake sync.
 */
import { createTool } from '@mastra/core/tools';
import { and, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { workspaceFiles } from '../../schema';
import { buildRegistry, createVobaseCommand } from './commands';
import { bookingCommands } from './commands/booking';
import { conversationCommands } from './commands/conversation';
import { queryCommands } from './commands/query';
import type { WakeContext } from './commands/types';
import { materializeMessages } from './materialize-messages';
import {
  loadWorkspaceFile,
  materializeBookings,
  materializeProfile,
  materializeRelevant,
  materializeState,
} from './materializers';

/**
 * Create an agent workspace: virtual FS + bash instance + dirty-file tracking.
 *
 * Returns the bash instance and a function to get modified files for DB sync.
 */
export async function createWorkspace(
  ctx: WakeContext,
  onSideEffect?: () => void,
) {
  const { Bash, InMemoryFs } = await import('just-bash');
  const fs = new InMemoryFs();
  const { db, contactId, conversationId, agentId } = ctx;

  // Pre-populate global files from workspaceFiles table
  const globalFiles = await db
    .select({ path: workspaceFiles.path, content: workspaceFiles.content })
    .from(workspaceFiles)
    .where(
      and(isNull(workspaceFiles.agentId), isNull(workspaceFiles.contactId)),
    );

  for (const file of globalFiles) {
    await fs.writeFile(`/workspace/${file.path}`, file.content);
  }

  // Materialize per-contact/conversation files in parallel
  const [messagesContent, stateContent, profileContent, notesContent] =
    await Promise.all([
      materializeMessages(db, conversationId),
      materializeState(db, conversationId),
      materializeProfile(db, contactId),
      loadWorkspaceFile(db, agentId, contactId, 'contact/notes.md'),
    ]);

  await fs.writeFile('/workspace/conversation/messages.md', messagesContent);
  await fs.writeFile('/workspace/conversation/state.md', stateContent);
  await fs.writeFile('/workspace/contact/profile.md', profileContent);
  await fs.writeFile(
    '/workspace/contact/notes.md',
    notesContent ?? '---\n---\n\n# Notes\n',
  );

  // Snapshot eagerly-loaded files BEFORE registering lazy files
  // (reading lazy files would trigger their DB queries, defeating lazy loading)
  const initialSnapshot = new Map<string, string>();
  for (const path of fs.getAllPaths()) {
    const stat = await fs.stat(path);
    if (stat.isFile) {
      const content = await fs.readFile(path);
      initialSnapshot.set(path, content);
    }
  }

  // Lazy-load bookings and relevant KB (only fetched if agent reads them)
  const lazyPaths = new Set([
    '/workspace/contact/bookings.md',
    '/workspace/knowledge/relevant.md',
  ]);
  fs.writeFileLazy('/workspace/contact/bookings.md', async () => {
    return materializeBookings(db, contactId);
  });
  fs.writeFileLazy('/workspace/knowledge/relevant.md', async () => {
    return materializeRelevant(db, conversationId);
  });

  // Build command registry and bash instance
  const registry = buildRegistry(
    conversationCommands,
    bookingCommands,
    queryCommands,
  );
  const vobaseCmd = createVobaseCommand(ctx, registry, onSideEffect);
  const bash = new Bash({ fs, customCommands: [vobaseCmd] });

  return {
    bash,
    fs,

    /** Get files modified or created during the agent's run. */
    getDirtyFiles: async (): Promise<
      Array<{ path: string; content: string }>
    > => {
      const dirty: Array<{ path: string; content: string }> = [];
      for (const path of fs.getAllPaths()) {
        // Only track files within the workspace directory
        if (!path.startsWith('/workspace/')) continue;
        // Skip lazy files that were never read (still in lazy state)
        if (lazyPaths.has(path) && !initialSnapshot.has(path)) {
          // Only check if the agent actually read/wrote this path
          const exists = await fs.exists(path);
          if (!exists) continue;
        }
        const stat = await fs.stat(path);
        if (!stat.isFile) continue;
        const content = await fs.readFile(path);
        const original = initialSnapshot.get(path);
        if (original === undefined || original !== content) {
          const relativePath = path.startsWith('/workspace/')
            ? path.slice('/workspace/'.length)
            : path;
          dirty.push({ path: relativePath, content });
        }
      }
      return dirty;
    },
  };
}

/**
 * Wrap a just-bash Bash instance as a single Mastra tool.
 * This is the only tool the agent needs.
 */
export function createMastraBashTool(bashInstance: {
  exec: (
    cmd: string,
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}) {
  return createTool({
    id: 'bash',
    description:
      'Run bash commands in the workspace. Read files with cat, write with echo/tee, run vobase commands for actions. Run `ls /workspace/` to see the layout or `vobase help` for commands.',
    inputSchema: z.object({
      command: z
        .string()
        .describe(
          'The bash command to run (e.g. "cat /workspace/conversation/messages.md" or "vobase reply Hello!")',
        ),
    }),
    execute: async ({ command }) => {
      const result = await bashInstance.exec(command);
      const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
      return output || '(no output)';
    },
  });
}
