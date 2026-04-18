/**
 * Single typed `bash` AgentTool — the only tool the LLM sees. Spec §9.3.
 *
 * Wraps `just-bash` `Bash.exec` into the contracts `ToolResult` envelope.
 * Oversized stdout spills to `/workspace/tmp/tool-<callId>.txt` and the content
 * preview points the model at that path (ChromaFs pattern).
 *
 * Note: `Bash.exec` here refers to `just-bash`'s in-process interpreter entry
 * point, NOT node:child_process. No real subprocess is spawned.
 */

import type { AgentTool, ToolExecutionContext } from '@server/contracts/plugin-context'
import type { ToolResult } from '@server/contracts/tool-result'
import type { Bash } from 'just-bash'

export interface BashToolArgs {
  command: string
}

export interface BashToolResult {
  stdout: string
  stderr: string
  exitCode: number
}

/** Hard cap before we spill tool output to a file. */
export const BASH_PREVIEW_BYTES = 4_000

interface BashToolDeps {
  bash: Bash
  /** Bypasses RO enforcement — used to persist spill files. */
  innerWrite: (path: string, content: string) => Promise<void>
}

/** Build the single bash tool. Shape matches our local `AgentTool<TArgs,TResult>` contract. */
export function makeBashTool(deps: BashToolDeps): AgentTool<BashToolArgs, BashToolResult> {
  return {
    name: 'bash',
    description:
      'Run bash commands in the virtual workspace. Read files with cat, grep; navigate with ls, find; take side-effecting actions through `vobase` subcommands. The workspace layout is documented in /workspace/AGENTS.md.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The bash command to run (e.g. "cat /workspace/drive/BUSINESS.md").',
        },
      },
      required: ['command'],
    },
    async execute(args: BashToolArgs, ctx: ToolExecutionContext): Promise<ToolResult<BashToolResult>> {
      if (!args || typeof args.command !== 'string') {
        return { ok: false, error: 'bash: missing required `command` string' }
      }
      const res = await deps.bash.exec(args.command)
      const out: BashToolResult = { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode }

      const stdoutBytes = Buffer.byteLength(res.stdout, 'utf8')
      if (stdoutBytes > BASH_PREVIEW_BYTES) {
        const spillPath = `/workspace/tmp/tool-${ctx.toolCallId}.txt`
        const preview = res.stdout.slice(0, BASH_PREVIEW_BYTES)
        try {
          await deps.innerWrite(spillPath, res.stdout)
        } catch {
          /* best-effort spill; still return the preview. */
        }
        return {
          ok: true,
          content: { ...out, stdout: preview },
          persisted: { path: spillPath, size: stdoutBytes, preview },
        }
      }

      return { ok: true, content: out }
    },
  }
}
