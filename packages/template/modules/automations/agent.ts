/**
 * Agent-facing surfaces for the automations module.
 *
 * No listeners or wake-time materializers: rules don't change per
 * conversation, and the cron-tick driver is invoked from `jobs.ts`, not from
 * the agent. The only contribution is an `INDEX.md` summary block listing the
 * org's enabled schedules so an agent reading `/INDEX.md` can see what fires
 * automatically (slug, cron, last-tick) without a CLI call.
 */

import type { AutomationsService } from '@modules/automations/service/automations'
import { type AgentTool, defineIndexContributor, type IndexContributor } from '@vobase/core'

import { createAutomationTool } from './tools/create-automation'
import { pauseAutomationTool } from './tools/pause-automation'

export const automationsTools: AgentTool[] = [createAutomationTool, pauseAutomationTool]

export { createAutomationTool, pauseAutomationTool }

export type AutomationsIndexReader = Pick<AutomationsService, 'listEnabled'>

export interface AutomationsIndexContributorOpts {
  organizationId: string
  automations: AutomationsIndexReader
}

const INDEX_FILE = 'INDEX.md'

export async function loadAutomationsIndexContributors(
  opts: AutomationsIndexContributorOpts,
): Promise<IndexContributor[]> {
  const enabled = await opts.automations.listEnabled({ organizationId: opts.organizationId }).catch(() => [])
  return [
    defineIndexContributor({
      file: INDEX_FILE,
      priority: 200,
      name: 'automations.enabled',
      render: () => {
        if (enabled.length === 0) return null
        const lines = [`# Schedules (${enabled.length})`, '']
        for (const s of enabled) {
          const last = s.lastTickAt ? new Date(s.lastTickAt).toISOString() : 'never'
          lines.push(`- ${s.slug} (cron=\`${s.cron}\` tz=${s.timezone}) — agent=${s.agentId} last-tick=${last}`)
        }
        return lines.join('\n')
      },
    }),
  ]
}

export { loadAutomationsIndexContributors as loadIndexContributors }
