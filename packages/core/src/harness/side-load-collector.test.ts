import { describe, expect, it } from 'bun:test'
import type { Bash } from 'just-bash'

import { type CustomSideLoadMaterializer, collectSideLoad, createBashHistoryMaterializer } from './side-load-collector'
import type { SideLoadContributor, SideLoadCtx, SideLoadItem } from './types'

function makeCtx(): SideLoadCtx {
  return {
    organizationId: 'org_1',
    conversationId: 'conv_1',
    turnIndex: 0,
  } as unknown as SideLoadCtx
}

const fakeBash = {} as Bash

function item(kind: SideLoadItem['kind'], priority: number, body: string): SideLoadItem {
  return { kind, priority, render: () => body } as SideLoadItem
}

describe('collectSideLoad', () => {
  it('returns empty string when no contributors produce items', async () => {
    const out = await collectSideLoad({
      ctx: makeCtx(),
      contributors: [],
      bash: fakeBash,
    })
    expect(out).toBe('')
  })

  it('orders items by priority descending and joins with horizontal rule', async () => {
    const contribA: SideLoadContributor = async () => [item('custom', 1, 'LOW')]
    const contribB: SideLoadContributor = async () => [item('custom', 10, 'HIGH')]
    const contribC: SideLoadContributor = async () => [item('custom', 5, 'MID')]

    const out = await collectSideLoad({
      ctx: makeCtx(),
      contributors: [contribA, contribB, contribC],
      bash: fakeBash,
    })

    expect(out).toBe('HIGH\n\n---\n\nMID\n\n---\n\nLOW')
  })

  it('swallows contributor errors — one bad module does not break others', async () => {
    // biome-ignore lint/suspicious/useAwait: SideLoadContributor contract requires async signature
    const bad: SideLoadContributor = async () => {
      throw new Error('boom')
    }
    const good: SideLoadContributor = async () => [item('custom', 1, 'survived')]
    const out = await collectSideLoad({
      ctx: makeCtx(),
      contributors: [bad, good],
      bash: fakeBash,
    })
    expect(out).toBe('survived')
  })

  it('skips custom materializers that return empty bodies', async () => {
    const emptyOne: CustomSideLoadMaterializer = {
      kind: 'custom',
      priority: 5,
      contribute: () => '',
    }
    const realOne: CustomSideLoadMaterializer = {
      kind: 'custom',
      priority: 1,
      contribute: () => 'hi',
    }
    const out = await collectSideLoad({
      ctx: makeCtx(),
      contributors: [],
      customMaterializers: [emptyOne, realOne],
      bash: fakeBash,
    })
    expect(out).toBe('hi')
  })

  it('passes bash through to custom materializers', async () => {
    let seen: unknown = null
    const materializer: CustomSideLoadMaterializer = {
      kind: 'custom',
      priority: 1,
      contribute: (ctx) => {
        seen = ctx.bash
        return 'ok'
      },
    }
    await collectSideLoad({
      ctx: makeCtx(),
      contributors: [],
      customMaterializers: [materializer],
      bash: fakeBash,
    })
    expect(seen).toBe(fakeBash)
  })

  it('filters out items whose render() throws', async () => {
    const throwing: SideLoadContributor = async () =>
      [
        {
          kind: 'custom',
          priority: 5,
          render: () => {
            throw new Error('render fail')
          },
        },
      ] as unknown as SideLoadItem[]
    const good: SideLoadContributor = async () => [item('custom', 1, 'kept')]

    const out = await collectSideLoad({
      ctx: makeCtx(),
      contributors: [throwing, good],
      bash: fakeBash,
    })
    expect(out).toBe('kept')
  })
})

describe('createBashHistoryMaterializer', () => {
  it('returns empty when history is empty', () => {
    const m = createBashHistoryMaterializer(() => [])
    expect(m.contribute({ ...makeCtx(), bash: fakeBash })).toBe('')
  })

  it('renders a bullet list under the Last turn side-effects heading', () => {
    const m = createBashHistoryMaterializer(() => ['ls -la', 'cat /tmp/x'])
    const out = m.contribute({ ...makeCtx(), bash: fakeBash })
    expect(out).toBe('## Last turn side-effects\n\n- `ls -la`\n- `cat /tmp/x`')
  })

  it('re-reads history on each contribute() call (snapshot-fresh)', () => {
    let hist: string[] = ['first']
    const m = createBashHistoryMaterializer(() => hist)
    expect(m.contribute({ ...makeCtx(), bash: fakeBash })).toContain('- `first`')

    hist = ['second', 'third']
    const out2 = m.contribute({ ...makeCtx(), bash: fakeBash }) as string
    expect(out2).toContain('- `second`')
    expect(out2).toContain('- `third`')
    expect(out2).not.toContain('- `first`')
  })

  it('has priority 0 so it sorts BELOW baseline-priority-1 contributors', async () => {
    const m = createBashHistoryMaterializer(() => ['echo hi'])
    const baseline: SideLoadContributor = async () => [item('custom', 1, 'baseline')]

    const out = await collectSideLoad({
      ctx: makeCtx(),
      contributors: [baseline],
      customMaterializers: [m],
      bash: fakeBash,
    })
    const baselineIdx = out.indexOf('baseline')
    const historyIdx = out.indexOf('Last turn side-effects')
    expect(baselineIdx).toBeGreaterThan(-1)
    expect(historyIdx).toBeGreaterThan(baselineIdx)
  })
})
