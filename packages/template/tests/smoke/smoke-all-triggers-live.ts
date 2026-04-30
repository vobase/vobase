#!/usr/bin/env bun
/**
 * Drives every wake-trigger smoke against a live dev server in sequence and
 * reports a single pass/fail summary. Intended for the manual sanity check
 * after a behavioural change to the agent (prompt edits, tool catalogue
 * shuffles, materializer changes) — exercises all four lanes end-to-end with
 * a real LLM so that "manually I checked one trigger and it worked" no longer
 * masks regressions in the others.
 *
 * Lanes / triggers covered:
 *   - inbound_message       → smoke-inbound-live.ts        (HMAC-signed webhook → conv-lane wake)
 *   - supervisor (action)   → smoke-supervisor-action-live (note → conv-lane wake → 3 cross-module effects)
 *   - operator_thread       → smoke-operator-thread-live   (staff DM → standalone-lane wake)
 *   - heartbeat             → smoke-heartbeat-live         (cron-tick → standalone-lane wake)
 *
 * Each child smoke is a separate `bun run` so failures stay isolated and
 * stdout/stderr stream live. The driver keeps no test framework — it's a
 * deliberate `for` loop so the failure mode is whatever the inner smoke
 * already prints.
 *
 * Requires:
 *   - dev server on :3000 (`bun run dev:server`)
 *   - OPENAI_API_KEY (or BIFROST) configured
 *   - Postgres on :5432 with the standard seed (`bun run db:reset`)
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 bun run tests/smoke/smoke-all-triggers-live.ts
 *
 * Env passthrough: every env var the child smokes consume (BASE_URL,
 * SMOKE_EMAIL, ORG_ID, POLL_S, etc.) is inherited unchanged.
 */

import { spawn } from 'node:child_process'

interface SmokeResult {
  name: string
  trigger: string
  exitCode: number
  durationMs: number
}

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'

const CHILD_SMOKES: { name: string; trigger: string; file: string }[] = [
  { name: 'inbound', trigger: 'inbound_message', file: 'tests/smoke/smoke-inbound-live.ts' },
  { name: 'supervisor-action', trigger: 'supervisor', file: 'tests/smoke/smoke-supervisor-action-live.ts' },
  { name: 'operator-thread', trigger: 'operator_thread', file: 'tests/smoke/smoke-operator-thread-live.ts' },
  { name: 'heartbeat', trigger: 'heartbeat', file: 'tests/smoke/smoke-heartbeat-live.ts' },
]

function runSmoke(file: string): Promise<number> {
  return new Promise<number>((resolve) => {
    const child = spawn('bun', ['run', file], { stdio: 'inherit', env: process.env })
    child.on('exit', (code) => resolve(code ?? 1))
    child.on('error', () => resolve(1))
  })
}

async function main(): Promise<void> {
  console.log(`[smoke:all-triggers] target=${BASE_URL} smokes=${CHILD_SMOKES.length}`)
  const results: SmokeResult[] = []
  for (const s of CHILD_SMOKES) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    console.log(`[smoke:all-triggers] ▶ ${s.name} (${s.trigger})`)
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)
    const start = Date.now()
    const exitCode = await runSmoke(s.file)
    const durationMs = Date.now() - start
    results.push({ name: s.name, trigger: s.trigger, exitCode, durationMs })
    console.log(`\n[smoke:all-triggers] ◀ ${s.name} exitCode=${exitCode} durationMs=${durationMs}\n`)
  }

  console.log('\n=== SUMMARY ===')
  for (const r of results) {
    const symbol = r.exitCode === 0 ? '✓' : '✗'
    const ms = `${r.durationMs}ms`.padStart(8, ' ')
    console.log(`  ${symbol} ${r.name.padEnd(20, ' ')} ${r.trigger.padEnd(20, ' ')} ${ms} (exitCode=${r.exitCode})`)
  }
  const failed = results.filter((r) => r.exitCode !== 0)
  if (failed.length === 0) {
    console.log('\n✅ all triggers healthy')
    process.exit(0)
  }
  console.error(`\n❌ ${failed.length}/${results.length} smoke(s) failed: ${failed.map((f) => f.name).join(', ')}`)
  process.exit(failed[0].exitCode || 1)
}

await main()
