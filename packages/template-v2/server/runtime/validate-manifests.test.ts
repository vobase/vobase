import { describe, expect, it } from 'bun:test'
import { defineModule, type ModuleInstance, type ModuleManifest } from './define-module'
import {
  checkProvidesId,
  ManifestCollisionError,
  ManifestMalformedError,
  ManifestMismatchError,
  NamespaceViolationError,
  validateManifests,
} from './validate-manifests'

function mk(name: string, manifest: ModuleManifest): ModuleInstance {
  return defineModule({ name, version: '1.0.0', manifest, init: () => undefined })
}

describe('validateManifests — workspace ownership', () => {
  it('passes when modules claim disjoint prefixes', () => {
    const a = mk('inbox', {
      provides: {},
      permissions: [],
      workspace: { owns: [{ kind: 'prefix', path: '/workspace/conversation/' }] },
    })
    const b = mk('drive', {
      provides: {},
      permissions: [],
      workspace: { owns: [{ kind: 'prefix', path: '/workspace/drive/' }] },
    })
    expect(() => validateManifests([a, b])).not.toThrow()
  })

  it('throws ManifestCollisionError when two modules claim overlapping prefixes', () => {
    const a = mk('inbox', {
      provides: {},
      permissions: [],
      workspace: { owns: [{ kind: 'prefix', path: '/workspace/conversation/' }] },
    })
    const b = mk('other', {
      provides: {},
      permissions: [],
      workspace: { owns: [{ kind: 'prefix', path: '/workspace/conversation/nested/' }] },
    })
    expect(() => validateManifests([a, b])).toThrow(ManifestCollisionError)
  })

  it('throws ManifestCollisionError when exact path falls under another module prefix', () => {
    const a = mk('drive', {
      provides: {},
      permissions: [],
      workspace: { owns: [{ kind: 'prefix', path: '/workspace/drive/' }] },
    })
    const b = mk('other', {
      provides: {},
      permissions: [],
      workspace: { owns: [{ kind: 'exact', path: '/workspace/drive/BUSINESS.md' }] },
    })
    expect(() => validateManifests([a, b])).toThrow(ManifestCollisionError)
  })

  it('throws NamespaceViolationError when module claims a runtime-owned prefix', () => {
    const a = mk('rogue', {
      provides: {},
      permissions: [],
      workspace: { owns: [{ kind: 'prefix', path: '/workspace/tmp/' }] },
    })
    expect(() => validateManifests([a])).toThrow(NamespaceViolationError)
  })

  it('throws NamespaceViolationError when module claims /workspace/AGENTS.md', () => {
    const a = mk('rogue', {
      provides: {},
      permissions: [],
      workspace: { owns: [{ kind: 'exact', path: '/workspace/AGENTS.md' }] },
    })
    expect(() => validateManifests([a])).toThrow(NamespaceViolationError)
  })
})

describe('validateManifests — tables / queues / buckets', () => {
  it('rejects bare table names (must be schema-qualified)', () => {
    const a = mk('inbox', {
      provides: {},
      permissions: [],
      tables: ['conversations'],
    })
    expect(() => validateManifests([a])).toThrow(ManifestMalformedError)
  })

  it('accepts fully-qualified schema.table names', () => {
    const a = mk('inbox', {
      provides: {},
      permissions: [],
      tables: ['public.conversations', 'public.messages'],
    })
    expect(() => validateManifests([a])).not.toThrow()
  })

  it('throws when two modules claim the same table', () => {
    const a = mk('inbox', {
      provides: {},
      permissions: [],
      tables: ['public.conversations'],
    })
    const b = mk('other', {
      provides: {},
      permissions: [],
      tables: ['public.conversations'],
    })
    expect(() => validateManifests([a, b])).toThrow(ManifestCollisionError)
  })

  it('throws when two modules claim the same queue suffix', () => {
    const a = mk('inbox', { provides: {}, permissions: [], queues: ['snooze'] })
    const b = mk('other', { provides: {}, permissions: [], queues: ['snooze'] })
    expect(() => validateManifests([a, b])).toThrow(ManifestCollisionError)
  })

  it('throws when two modules claim the same bucket suffix', () => {
    const a = mk('drive', { provides: {}, permissions: [], buckets: ['attachments'] })
    const b = mk('other', { provides: {}, permissions: [], buckets: ['attachments'] })
    expect(() => validateManifests([a, b])).toThrow(ManifestCollisionError)
  })
})

describe('validateManifests — command verb prefix', () => {
  it('passes when command verbs are disjoint across modules', () => {
    const a = mk('inbox', {
      provides: { commands: ['inbox:list', 'inbox:get'] },
      permissions: [],
    })
    const b = mk('drive', {
      provides: { commands: ['drive:list', 'drive:cat'] },
      permissions: [],
    })
    expect(() => validateManifests([a, b])).not.toThrow()
  })

  it('throws when two modules claim the same command verb prefix', () => {
    const a = mk('a', { provides: { commands: ['foo'] }, permissions: [] })
    const b = mk('b', { provides: { commands: ['foo'] }, permissions: [] })
    expect(() => validateManifests([a, b])).toThrow(ManifestCollisionError)
  })
})

describe('checkProvidesId — observer / mutator id cross-check', () => {
  it('passes when id is declared', () => {
    expect(() => checkProvidesId('agents', 'observer', 'agents:audit', ['agents:audit', 'agents:sse'])).not.toThrow()
  })

  it('throws ManifestMismatchError when registered id is not declared', () => {
    expect(() => checkProvidesId('agents', 'observer', 'agents:ghost', ['agents:audit'])).toThrow(ManifestMismatchError)
  })

  it('throws with a legible error message naming the id and declared list', () => {
    try {
      checkProvidesId('agents', 'mutator', 'agents:rogue', ['agents:moderation', 'agents:approval'])
      throw new Error('should not reach')
    } catch (err) {
      expect(err).toBeInstanceOf(ManifestMismatchError)
      const e = err as ManifestMismatchError
      expect(e.message).toContain('agents:rogue')
      expect(e.message).toContain('agents:moderation')
      expect(e.message).toContain('agents:approval')
    }
  })
})
