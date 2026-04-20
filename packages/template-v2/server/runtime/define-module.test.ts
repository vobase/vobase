import { describe, expect, it } from 'bun:test'
import {
  defineModule,
  InvalidModuleError,
  isModuleInstance,
  type ModuleManifest,
  sortModules,
  type WorkspacePath,
} from './define-module'

const validDef = {
  name: 'inbox',
  version: '1.0.0',
  manifest: { provides: { tools: ['send_text'] }, permissions: ['db.write'] } satisfies ModuleManifest,
  init: () => undefined,
}

describe('defineModule', () => {
  it('returns a marked module instance on valid input', () => {
    const m = defineModule(validDef)
    expect(isModuleInstance(m)).toBe(true)
    expect(m.name).toBe('inbox')
  })

  it('rejects an invalid module name', () => {
    expect(() => defineModule({ ...validDef, name: 'Inbox!' })).toThrow(InvalidModuleError)
  })

  it('rejects a non-semver version', () => {
    expect(() => defineModule({ ...validDef, version: 'v1' })).toThrow(InvalidModuleError)
  })

  it('requires a manifest with provides + permissions', () => {
    expect(() =>
      defineModule({
        ...validDef,
        manifest: undefined as unknown as (typeof validDef)['manifest'],
      }),
    ).toThrow(InvalidModuleError)
  })
})

describe('sortModules', () => {
  it('topologically orders by requires', () => {
    const contacts = defineModule({ ...validDef, name: 'contacts' })
    const drive = defineModule({ ...validDef, name: 'drive' })
    const inbox = defineModule({ ...validDef, name: 'inbox', requires: ['contacts', 'drive'] })
    const agents = defineModule({ ...validDef, name: 'agents', requires: ['inbox'] })
    const sorted = sortModules([agents, inbox, contacts, drive]).map((m) => m.name)
    expect(sorted.indexOf('contacts')).toBeLessThan(sorted.indexOf('inbox'))
    expect(sorted.indexOf('drive')).toBeLessThan(sorted.indexOf('inbox'))
    expect(sorted.indexOf('inbox')).toBeLessThan(sorted.indexOf('agents'))
  })

  it('detects circular requires', () => {
    const a = defineModule({ ...validDef, name: 'a', requires: ['b'] })
    const b = defineModule({ ...validDef, name: 'b', requires: ['a'] })
    expect(() => sortModules([a, b])).toThrow(InvalidModuleError)
  })

  it('rejects references to unknown modules', () => {
    const a = defineModule({ ...validDef, name: 'a', requires: ['ghost'] })
    expect(() => sortModules([a])).toThrow(InvalidModuleError)
  })
})

describe('defineModule — extended manifest (Step 1)', () => {
  it('accepts workspace.owns with prefix and exact discriminants', () => {
    const manifest: ModuleManifest = {
      provides: { tools: [] },
      permissions: [],
      workspace: {
        owns: [
          { kind: 'prefix', path: '/workspace/conversation/' },
          { kind: 'exact', path: '/workspace/SOUL.md' },
        ],
        frozenEager: [{ kind: 'exact', path: '/workspace/SOUL.md' }],
        materializers: {
          soulMd: { path: '/workspace/SOUL.md', phase: 'frozen' },
        },
      },
    }
    const m = defineModule({ ...validDef, manifest })
    expect(m.manifest.workspace?.owns.length).toBe(2)
    expect(m.manifest.workspace?.owns[0].kind).toBe('prefix')
    expect(m.manifest.workspace?.owns[1].kind).toBe('exact')
  })

  it('accepts tables, queues, buckets, accessGrants', () => {
    const manifest: ModuleManifest = {
      provides: {},
      permissions: [],
      tables: ['public.conversations', 'public.messages'],
      queues: ['snooze'],
      buckets: ['attachments'],
      accessGrants: [{ to: 'agents', reason: 'LearningProposal builder', path: 'service/learning-proposals' }],
    }
    const m = defineModule({ ...validDef, manifest })
    expect(m.manifest.tables).toEqual(['public.conversations', 'public.messages'])
    expect(m.manifest.queues).toEqual(['snooze'])
    expect(m.manifest.buckets).toEqual(['attachments'])
    expect(m.manifest.accessGrants?.[0].to).toBe('agents')
  })

  it('keeps extended manifest fields fully optional (backward compatible)', () => {
    const m = defineModule(validDef)
    expect(m.manifest.workspace).toBeUndefined()
    expect(m.manifest.tables).toBeUndefined()
    expect(m.manifest.queues).toBeUndefined()
    expect(m.manifest.buckets).toBeUndefined()
    expect(m.manifest.accessGrants).toBeUndefined()
  })

  it('discriminated-union type narrows correctly at runtime', () => {
    const owns: WorkspacePath[] = [
      { kind: 'prefix', path: '/workspace/drive/' },
      { kind: 'exact', path: '/workspace/drive/BUSINESS.md' },
    ]
    const kinds = owns.map((p) => p.kind)
    expect(kinds).toEqual(['prefix', 'exact'])
    for (const p of owns) {
      if (p.kind === 'prefix') {
        expect(p.path.endsWith('/')).toBe(true)
      } else {
        expect(p.path.endsWith('/')).toBe(false)
      }
    }
  })
})
