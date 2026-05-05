/**
 * Agent-facing surfaces for the channels umbrella.
 *
 * Aggregates per-adapter `agentsMd` contributors and `platformHints`. The
 * umbrella never inlines its own behavior fragments — each adapter owns the
 * prose for the channel-specific semantics it surfaces (echoes, native
 * threading, platform formatting/cadence, etc.).
 */
import type { HarnessPlatformHint, IndexContributor } from '@vobase/core'

import { webPlatformHint } from './adapters/web/agent'
import { whatsappAgentsMdContributors, whatsappPlatformHint } from './adapters/whatsapp/agent'

export const channelsAgent = {
  agentsMd: [...whatsappAgentsMdContributors] as IndexContributor[],
  platformHints: [webPlatformHint, whatsappPlatformHint] as HarnessPlatformHint[],
} satisfies { agentsMd?: IndexContributor[]; platformHints?: HarnessPlatformHint[] }
