/**
 * Single typed `bash` AgentTool — the only tool the LLM sees.
 * Spill thresholds (L1/L2/L3) live in `turn-budget.ts`.
 * Commands that read /workspace/tmp/tool-*.txt bypass spill so the model can
 * pull its own previously-persisted output back without re-tripping the budget.
 */

import type { ToolResultPersistedEvent } from '@server/contracts/event'
import type { AgentTool, ToolExecutionContext } from '@server/contracts/plugin-context'
import type { ToolResult } from '@server/contracts/tool-result'
import type { Bash } from 'just-bash'
import { spillToFile } from './tool-budget-spill'
import { L1_PREVIEW_BYTES, L2_SPILL_BYTES, TurnBudget } from './turn-budget'

export interface BashToolArgs {
  command: string
}

export interface BashToolResult {
  stdout: string
  stderr: string
  exitCode: number
}

/** Re-exported for tests that reference the preview byte cap by name. */
export const BASH_PREVIEW_BYTES = L1_PREVIEW_BYTES

const SPILL_FILE_RE = /\/workspace\/tmp\/tool-[^\s'"]*\.txt/
/** Read-only utilities that may legitimately read a spill file without re-spilling. */
const READ_ONLY_TOKENS = new Set(['cat', 'head', 'tail', 'less', 'more', 'wc', 'grep', 'awk', 'sed'])

/**
 * True when the command is a single read-only utility invocation against a spill
 * file (or a trivial `bash -c "<read-only invocation>"` wrapper). Compound
 * commands (`&&`, `;`, `|`) don't qualify — they could pair a real read with a
 * side-effecting tool whose output should still hit the budget.
 */
function readsSpillFile(command: string): boolean {
  if (!SPILL_FILE_RE.test(command)) return false
  const trimmed = command.trim()
  if (/[;&|]/.test(trimmed.replace(/\\[;&|]/g, ''))) return false
  const firstToken = trimmed.split(/\s+/)[0] ?? ''
  if (READ_ONLY_TOKENS.has(firstToken)) return true
  if (firstToken === 'bash' || firstToken === 'sh') {
    const cArg = trimmed.match(/-c\s+(['"])([\s\S]*)\1/)
    if (!cArg) return false
    const inner = (cArg[2] ?? '').trim()
    if (/[;&|]/.test(inner.replace(/\\[;&|]/g, ''))) return false
    const innerFirst = inner.split(/\s+/)[0] ?? ''
    return READ_ONLY_TOKENS.has(innerFirst)
  }
  return false
}

interface BashToolDeps {
  bash: Bash
  /** Bypasses RO enforcement — used to persist spill files. */
  innerWrite: (path: string, content: string) => Promise<void>
  /** Shared per-turn budget; when omitted a private budget is used (no L3 coordination). */
  turnBudget?: TurnBudget
  /** Called on each L2/L3 spill; when omitted events are silently dropped. */
  onSpill?: (ev: ToolResultPersistedEvent) => void
}

/** Build the single bash tool. Shape matches our local `AgentTool<TArgs,TResult>` contract. */
export function makeBashTool(deps: BashToolDeps): AgentTool<BashToolArgs, BashToolResult> {
  const budget = deps.turnBudget ?? new TurnBudget()
  const onSpill = deps.onSpill ?? ((_ev: ToolResultPersistedEvent) => undefined)

  return {
    name: 'bash',
    description:
      'Run bash commands in the virtual workspace. Read files with cat, grep; navigate with ls, find; take side-effecting actions through `vobase` subcommands. The workspace layout is documented in /workspace/AGENTS.md.',
    parallelGroup: 'never',
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

      // Path exemption: model is explicitly reading a spill file it was told to read.
      if (readsSpillFile(args.command)) {
        return { ok: true, content: out }
      }

      const stdoutBytes = Buffer.byteLength(res.stdout, 'utf8')
      const shouldSpill = budget.isExceeded() || budget.wouldExceed(stdoutBytes) || stdoutBytes > L2_SPILL_BYTES

      if (shouldSpill) {
        const spillPath = `/workspace/tmp/tool-${ctx.toolCallId}.txt`
        const spilled = await spillToFile({
          stdout: res.stdout,
          spillPath,
          toolName: 'bash',
          ctx,
          innerWrite: deps.innerWrite,
          onSpill,
        })
        budget.record(spilled.byteLength)
        return {
          ok: true,
          content: { ...out, stdout: spilled.preview },
          persisted: spilled.persisted,
        }
      }

      budget.record(stdoutBytes)
      return { ok: true, content: out }
    },
  }
}
