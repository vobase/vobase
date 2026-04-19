import { describe, expect, it } from 'bun:test'
import type { AgentTool } from '@server/contracts/tool'
import type { ToolResult } from '@server/contracts/tool-result'
import { classifyBatch, pathsOverlap, type ToolCall } from './parallel-classifier'

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTool(name: string, pg: AgentTool['parallelGroup']): AgentTool {
  return {
    name,
    description: name,
    inputSchema: {},
    parallelGroup: pg,
    execute: async (): Promise<ToolResult<unknown>> => ({ ok: true, content: null }),
  }
}

function call(name: string, pg: AgentTool['parallelGroup'], args: unknown = {}): ToolCall {
  return { tool: makeTool(name, pg), args }
}

// ── pathsOverlap ─────────────────────────────────────────────────────────────

describe('pathsOverlap', () => {
  it('identical paths overlap', () => {
    expect(pathsOverlap('/workspace/a', '/workspace/a')).toBe(true)
  })

  it('parent/child paths overlap', () => {
    expect(pathsOverlap('/workspace', '/workspace/a/b')).toBe(true)
    expect(pathsOverlap('/workspace/a/b', '/workspace')).toBe(true)
  })

  it('sibling paths do not overlap', () => {
    expect(pathsOverlap('/workspace/a', '/workspace/b')).toBe(false)
  })

  it('trailing slash normalised', () => {
    expect(pathsOverlap('/workspace/a/', '/workspace/a')).toBe(true)
  })

  it('prefix match requires path separator boundary', () => {
    // '/workspace/ab' should NOT overlap '/workspace/a'
    expect(pathsOverlap('/workspace/ab', '/workspace/a')).toBe(false)
  })
})

// ── classifyBatch ─────────────────────────────────────────────────────────────

describe('classifyBatch', () => {
  it('empty list returns empty', () => {
    expect(classifyBatch([])).toEqual([])
  })

  it('single never call → serial group', () => {
    const groups = classifyBatch([call('bash', 'never')])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.kind).toBe('serial')
  })

  it('omitted parallelGroup treated as never', () => {
    const groups = classifyBatch([call('bash', undefined)])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.kind).toBe('serial')
  })

  it('two safe calls → single parallel group', () => {
    const groups = classifyBatch([call('read_a', 'safe'), call('read_b', 'safe')])
    expect(groups).toHaveLength(1)
    const g = groups[0]
    expect(g?.kind).toBe('parallel')
    if (g?.kind === 'parallel') expect(g.calls).toHaveLength(2)
  })

  it('never between two safe calls splits into three groups', () => {
    const groups = classifyBatch([call('read_a', 'safe'), call('bash', 'never'), call('read_b', 'safe')])
    expect(groups).toHaveLength(3)
    expect(groups[0]?.kind).toBe('parallel') // safe batch
    expect(groups[1]?.kind).toBe('serial') // never
    expect(groups[2]?.kind).toBe('parallel') // safe batch
  })

  it('path-scoped calls with non-overlapping paths → single parallel group', () => {
    const groups = classifyBatch([
      call('write_a', { kind: 'path-scoped', pathArg: 'path' }, { path: '/workspace/a' }),
      call('write_b', { kind: 'path-scoped', pathArg: 'path' }, { path: '/workspace/b' }),
    ])
    expect(groups).toHaveLength(1)
    const g = groups[0]
    expect(g?.kind).toBe('parallel')
    if (g?.kind === 'parallel') expect(g.calls).toHaveLength(2)
  })

  it('path-scoped calls with overlapping paths → separate serial groups', () => {
    const groups = classifyBatch([
      call('write_a', { kind: 'path-scoped', pathArg: 'path' }, { path: '/workspace/dir' }),
      call('write_b', { kind: 'path-scoped', pathArg: 'path' }, { path: '/workspace/dir/file' }),
    ])
    // second call overlaps first → must be flushed into a new group
    expect(groups).toHaveLength(2)
    expect(groups[0]?.kind).toBe('parallel')
    expect(groups[1]?.kind).toBe('parallel')
    if (groups[0]?.kind === 'parallel') expect(groups[0].calls).toHaveLength(1)
    if (groups[1]?.kind === 'parallel') expect(groups[1].calls).toHaveLength(1)
  })

  it('safe followed by path-scoped → separate groups', () => {
    const groups = classifyBatch([
      call('read_a', 'safe'),
      call('write_a', { kind: 'path-scoped', pathArg: 'path' }, { path: '/workspace/a' }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0]?.kind).toBe('parallel')
    expect(groups[1]?.kind).toBe('parallel')
  })
})
