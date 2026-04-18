import { describe, expect, it } from 'bun:test'
import { defineModule, InvalidModuleError, isModuleInstance, sortModules } from './define-module'

const validDef = {
  name: 'inbox',
  version: '1.0.0',
  manifest: { provides: { tools: ['send_text'] }, permissions: ['db.write'] },
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
