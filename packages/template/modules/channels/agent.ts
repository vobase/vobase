/**
 * Agent-facing surfaces for the channels module.
 *
 * Currently contributes a single AGENTS.md section explaining WhatsApp coexistence
 * echo semantics so agents don't mistakenly acknowledge staff-typed messages.
 */

import { defineIndexContributor, type IndexContributor } from '@vobase/core'

import { whatsappAgentsMd } from './adapters/whatsapp/agent'

const AGENTS_MD_FILE = 'AGENTS.md'

const channelsAgentsMdContributors: readonly IndexContributor[] = [
  defineIndexContributor({
    file: AGENTS_MD_FILE,
    priority: 55,
    name: 'channels.whatsapp-echoes',
    render: () => whatsappAgentsMd,
  }),
]

export const channelsAgent = {
  agentsMd: [...channelsAgentsMdContributors],
} satisfies { agentsMd?: IndexContributor[] }
