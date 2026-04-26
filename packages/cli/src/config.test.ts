import { mkdtempSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'

import { configPath, loadConfig, resolveConfigName, writeConfig } from './config'

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), 'vobase-cli-test-'))
}

describe('resolveConfigName', () => {
  it('prefers --config flag', () => {
    expect(resolveConfigName({ flag: 'acme', env: { VOBASE_CONFIG: 'foo' } })).toBe('acme')
  })

  it('falls back to VOBASE_CONFIG env', () => {
    expect(resolveConfigName({ env: { VOBASE_CONFIG: 'foo' } })).toBe('foo')
  })

  it('defaults to "config" when neither set', () => {
    expect(resolveConfigName({ env: {} })).toBe('config')
  })
})

describe('configPath', () => {
  it('joins ~/.vobase/<name>.json', () => {
    expect(configPath('acme', '/Users/dev')).toBe('/Users/dev/.vobase/acme.json')
  })
})

describe('loadConfig', () => {
  it('returns null when file is missing', async () => {
    const home = makeHome()
    const result = await loadConfig({ home })
    expect(result).toBeNull()
  })

  it('returns parsed config when file is valid', async () => {
    const home = makeHome()
    await writeConfig(
      {
        url: 'https://acme.vobase.app',
        apiKey: 'vbt_abc',
        organizationId: 'org_1',
        principal: { id: 'usr_1', email: 'a@b.co', name: 'Carl' },
      },
      { home, name: 'acme' },
    )
    const result = await loadConfig({ home, flag: 'acme' })
    expect(result?.url).toBe('https://acme.vobase.app')
    expect(result?.principal.email).toBe('a@b.co')
  })

  it('throws on malformed JSON', async () => {
    const home = makeHome()
    await Bun.write(configPath('bad', home), 'this is not json')
    await expect(loadConfig({ home, flag: 'bad' })).rejects.toThrow(/not valid JSON/)
  })

  it('throws on schema mismatch', async () => {
    const home = makeHome()
    await Bun.write(configPath('bad', home), JSON.stringify({ url: 'not-a-url' }))
    await expect(loadConfig({ home, flag: 'bad' })).rejects.toThrow(/invalid/)
  })
})

describe('writeConfig', () => {
  it('writes 0600 permissions', async () => {
    const home = makeHome()
    const path = await writeConfig(
      {
        url: 'https://acme.vobase.app',
        apiKey: 'vbt_abc',
        organizationId: 'org_1',
        principal: { id: 'usr_1' },
      },
      { home },
    )
    const stats = await stat(path)
    // Mode is masked with 0o777 — we only care about the user/group/other rwx bits.
    expect(stats.mode & 0o777).toBe(0o600)
  })
})
