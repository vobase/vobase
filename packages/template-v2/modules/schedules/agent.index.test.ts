/**
 * Unit tests for `loadSchedulesIndexContributors` — the `/INDEX.md` enabled-
 * schedules summary block. Uses a stub `SchedulesService` slice; no DB.
 */

import { describe, expect, it } from 'bun:test'
import { IndexFileBuilder } from '@vobase/core'

import { loadSchedulesIndexContributors, type SchedulesIndexReader } from './agent'

const ORG_ID = 'org0test0'

type EnabledRow = Awaited<ReturnType<SchedulesIndexReader['listEnabled']>>[number]

function fakeRow(overrides: Partial<EnabledRow>): EnabledRow {
  return {
    id: overrides.id ?? 'sch1',
    agentId: overrides.agentId ?? 'agt1',
    slug: overrides.slug ?? 'a',
    cron: overrides.cron ?? '0 * * * *',
    timezone: overrides.timezone ?? 'UTC',
    lastTickAt: overrides.lastTickAt ?? null,
  }
}

function makeReader(rows: EnabledRow[]): SchedulesIndexReader {
  return {
    listEnabled(_input) {
      return Promise.resolve(rows)
    },
  }
}

describe('loadSchedulesIndexContributors', () => {
  it('returns a contributor whose render is null when no schedules are enabled', async () => {
    const contribs = await loadSchedulesIndexContributors({ organizationId: ORG_ID, schedules: makeReader([]) })
    expect(contribs).toHaveLength(1)
    expect(contribs[0].render({ file: 'INDEX.md' })).toBeNull()
  })

  it('renders heading + one bullet per enabled schedule with cron + tz', async () => {
    const rows = [
      fakeRow({ slug: 'heartbeat-operator', cron: '0 18 * * *', timezone: 'America/Los_Angeles', agentId: 'agt-op' }),
      fakeRow({
        slug: 'stale-triage',
        cron: '0 8 * * *',
        agentId: 'agt-c',
        lastTickAt: new Date('2026-04-25T08:00:00Z'),
      }),
    ]
    const contribs = await loadSchedulesIndexContributors({ organizationId: ORG_ID, schedules: makeReader(rows) })
    const out = contribs[0].render({ file: 'INDEX.md' }) ?? ''
    expect(out).toContain('# Schedules (2)')
    expect(out).toContain('heartbeat-operator')
    expect(out).toContain('cron=`0 18 * * *`')
    expect(out).toContain('tz=America/Los_Angeles')
    expect(out).toContain('agent=agt-op')
    expect(out).toContain('last-tick=never')
    expect(out).toContain('last-tick=2026-04-25T08:00:00.000Z')
  })

  it('swallows reader errors and yields a null section', async () => {
    const reader: SchedulesIndexReader = {
      listEnabled() {
        return Promise.reject(new Error('boom'))
      },
    }
    const contribs = await loadSchedulesIndexContributors({ organizationId: ORG_ID, schedules: reader })
    expect(contribs[0].render({ file: 'INDEX.md' })).toBeNull()
  })

  it('targets the INDEX.md build only', async () => {
    const contribs = await loadSchedulesIndexContributors({
      organizationId: ORG_ID,
      schedules: makeReader([fakeRow({ slug: 'a' })]),
    })
    const builder = new IndexFileBuilder().registerAll(contribs)
    expect(builder.build({ file: 'AGENTS.md' })).toBe('')
    expect(builder.build({ file: 'INDEX.md' })).toContain('Schedules (1)')
  })
})
