/**
 * Channel-specific authoring guidance surfaced in the frozen system prompt.
 *
 * Each adapter under `modules/channels/adapters/<name>/agent.ts` declares its
 * own `HarnessPlatformHint`; the channels umbrella aggregates them on
 * `channelsAgent.platformHints`. We index by `kind` here so adding a new
 * adapter only touches its own folder.
 *
 * Unknown kinds return `undefined`; the frozen-prompt builder falls back to a
 * "no guidance" message in `wake/prompt.ts::renderPlatformHint`.
 */
import { channelsAgent } from '@modules/channels/agent'
import type { HarnessPlatformHint } from '@vobase/core'

const REGISTRY: Readonly<Record<string, HarnessPlatformHint>> = Object.fromEntries(
  channelsAgent.platformHints.map((h) => [h.kind, h]),
)

export function resolvePlatformHint(kind: string | null | undefined): HarnessPlatformHint | undefined {
  if (!kind) return undefined
  return REGISTRY[kind]
}
