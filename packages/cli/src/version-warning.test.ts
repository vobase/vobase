import { beforeEach, describe, expect, it } from 'bun:test'

import { __resetVersionWarningForTests, maybeWarnVersionSkew } from './version-warning'

describe('maybeWarnVersionSkew', () => {
  let lines: string[]

  beforeEach(() => {
    __resetVersionWarningForTests()
    lines = []
  })

  const stderr = (s: string) => lines.push(s)

  it('no-ops when latest is undefined', () => {
    maybeWarnVersionSkew({ installed: '0.7.0', latest: undefined, stderr })
    expect(lines).toHaveLength(0)
  })

  it('no-ops when installed === latest', () => {
    maybeWarnVersionSkew({ installed: '0.7.0', latest: '0.7.0', stderr })
    expect(lines).toHaveLength(0)
  })

  it('no-ops when installed > latest (major ahead)', () => {
    maybeWarnVersionSkew({ installed: '0.8.0', latest: '0.7.0', stderr })
    expect(lines).toHaveLength(0)
  })

  it('warns when installed < latest', () => {
    maybeWarnVersionSkew({ installed: '0.6.5', latest: '0.7.0', stderr })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('0.6.5')
    expect(lines[0]).toContain('0.7.0')
    expect(lines[0]).toContain('bun add -g @vobase/cli')
  })

  it('warns exactly once across two consecutive calls', () => {
    maybeWarnVersionSkew({ installed: '0.6.5', latest: '0.7.0', stderr })
    maybeWarnVersionSkew({ installed: '0.6.5', latest: '0.7.0', stderr })
    expect(lines).toHaveLength(1)
  })

  it('fires again after __resetVersionWarningForTests', () => {
    maybeWarnVersionSkew({ installed: '0.6.5', latest: '0.7.0', stderr })
    expect(lines).toHaveLength(1)
    __resetVersionWarningForTests()
    const lines2: string[] = []
    maybeWarnVersionSkew({ installed: '0.6.5', latest: '0.7.0', stderr: (s) => lines2.push(s) })
    expect(lines2).toHaveLength(1)
  })

  it('patch-version: 0.7.0 vs 0.7.1 → warning', () => {
    maybeWarnVersionSkew({ installed: '0.7.0', latest: '0.7.1', stderr })
    expect(lines).toHaveLength(1)
  })

  it('patch-version: 0.7.1 vs 0.7.0 → no warning', () => {
    maybeWarnVersionSkew({ installed: '0.7.1', latest: '0.7.0', stderr })
    expect(lines).toHaveLength(0)
  })

  it('minor-version: 0.6.9 vs 0.7.0 → warning', () => {
    maybeWarnVersionSkew({ installed: '0.6.9', latest: '0.7.0', stderr })
    expect(lines).toHaveLength(1)
  })
})
