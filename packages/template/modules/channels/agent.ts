/**
 * Agent-facing surfaces for the channels umbrella.
 *
 * Aggregates per-adapter `agentsMd` contributors. The umbrella never inlines
 * its own behavior fragments — each adapter owns the prose for the channel-
 * specific semantics it surfaces (echoes, native threading, etc.).
 */
import type { IndexContributor } from '@vobase/core'

import { whatsappAgentsMdContributors } from './adapters/whatsapp/agent'

export const channelsAgent = {
  agentsMd: [...whatsappAgentsMdContributors] as IndexContributor[],
} satisfies { agentsMd?: IndexContributor[] }
