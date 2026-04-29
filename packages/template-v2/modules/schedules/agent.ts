/**
 * Agent-facing surfaces for the schedules module.
 *
 * No tools, listeners, or wake-time materializers: schedules don't change per
 * conversation, and the cron-tick driver is invoked from `jobs.ts`, not from
 * the agent. The only contribution is an `INDEX.md` summary block listing the
 * org's enabled schedules so an agent reading `/INDEX.md` can see what fires
 * automatically (slug, cron, last-tick) without a CLI call.
 */

import type { SchedulesService } from '@modules/schedules/service/schedules'
import { type AgentTool, defineIndexContributor, type IndexContributor } from '@vobase/core'

import { createScheduleTool } from './tools/create-schedule'
import { pauseScheduleTool } from './tools/pause-schedule'

export const schedulesTools: AgentTool[] = [createScheduleTool, pauseScheduleTool]

export { createScheduleTool, pauseScheduleTool }

export type SchedulesIndexReader = Pick<SchedulesService, 'listEnabled'>

export interface SchedulesIndexContributorOpts {
  organizationId: string
  schedules: SchedulesIndexReader
}

const INDEX_FILE = 'INDEX.md'

export async function loadSchedulesIndexContributors(opts: SchedulesIndexContributorOpts): Promise<IndexContributor[]> {
  const enabled = await opts.schedules.listEnabled({ organizationId: opts.organizationId }).catch(() => [])
  return [
    defineIndexContributor({
      file: INDEX_FILE,
      priority: 200,
      name: 'schedules.enabled',
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

export { loadSchedulesIndexContributors as loadIndexContributors }
