import { describe, expect, it } from 'bun:test'

import { classifyDrift } from './drift'

describe('classifyDrift', () => {
  it('reports in_sync when hashes match', () => {
    expect(classifyDrift({ rowOrigin: 'file', rowFileHash: 'abc', fileHash: 'abc' })).toBe('in_sync')
  })

  it('reports file_drifted when row was last seeded from file but file hash changed', () => {
    expect(classifyDrift({ rowOrigin: 'file', rowFileHash: 'abc', fileHash: 'def' })).toBe('file_drifted')
  })

  it('reports row_diverged when row was edited at runtime AND the file changed', () => {
    expect(classifyDrift({ rowOrigin: 'user', rowFileHash: 'abc', fileHash: 'def' })).toBe('row_diverged')
    expect(classifyDrift({ rowOrigin: 'agent', rowFileHash: null, fileHash: 'def' })).toBe('row_diverged')
  })

  it('reports in_sync even for user-origin rows when content matches', () => {
    expect(classifyDrift({ rowOrigin: 'user', rowFileHash: 'abc', fileHash: 'abc' })).toBe('in_sync')
  })
})
