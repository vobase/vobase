import { mkdirSync, mkdtempSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'

import {
  ConfigSchema,
  configPath,
  findConfigPath,
  loadConfig,
  localConfigPath,
  resolveConfigName,
  writeConfig,
} from './config'

const BASE_CONFIG = {
  url: 'https://acme.vobase.app',
  apiKey: 'vbt_abc',
  organizationId: 'org_1',
  principal: { id: 'usr_1' },
} as const

describe('ConfigSchema version field', () => {
  it('parses a v0 config (no version field) successfully', () => {
    const result = ConfigSchema.safeParse(BASE_CONFIG)
    expect(result.success).toBe(true)
  })

  it('parses a v1 config (version: 1) successfully', () => {
    const result = ConfigSchema.safeParse({ ...BASE_CONFIG, version: 1 })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.version).toBe(1)
  })

  it('rejects a config with version: 2 (forward-incompat)', () => {
    const result = ConfigSchema.safeParse({ ...BASE_CONFIG, version: 2 })
    expect(result.success).toBe(false)
    if (!result.success) {
      const msg = result.error.message
      expect(msg).toMatch(/invalid_literal|invalid_type|invalid_value|expected 1/i)
    }
  })
})

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

  it('local: true writes to <cwd>/.vobase/<name>.json', async () => {
    const cwd = makeHome() // reuse helper — just need an isolated temp dir
    const path = await writeConfig(
      {
        url: 'https://acme.vobase.app',
        apiKey: 'vbt_local',
        organizationId: 'org_1',
        principal: { id: 'usr_1' },
      },
      { local: true, cwd, name: 'acme' },
    )
    expect(path).toBe(join(cwd, '.vobase', 'acme.json'))
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })
})

describe('localConfigPath', () => {
  it('joins <dir>/.vobase/<name>.json', () => {
    expect(localConfigPath('acme', '/repo/client-acme')).toBe('/repo/client-acme/.vobase/acme.json')
  })
})

describe('findConfigPath — hybrid lookup', () => {
  function setupTwoTier() {
    const home = makeHome()
    const repo = mkdtempSync(join(tmpdir(), 'vobase-cli-repo-'))
    mkdirSync(join(repo, '.git'), { recursive: true })
    const sub = join(repo, 'packages', 'app')
    mkdirSync(sub, { recursive: true })
    return { home, repo, sub }
  }

  it('returns null when neither tier has the config', async () => {
    const { home, sub } = setupTwoTier()
    expect(await findConfigPath({ home, cwd: sub, flag: 'acme' })).toBeNull()
  })

  it('falls back to home when no local config exists', async () => {
    const { home, sub } = setupTwoTier()
    const homePath = await writeConfig(
      { url: 'https://acme.vobase.app', apiKey: 'k', organizationId: 'o', principal: { id: 'u' } },
      { home, name: 'acme' },
    )
    expect(await findConfigPath({ home, cwd: sub, flag: 'acme' })).toBe(homePath)
  })

  it('local config in cwd wins over home', async () => {
    const { home, repo, sub } = setupTwoTier()
    await writeConfig(
      { url: 'https://acme-home.vobase.app', apiKey: 'k', organizationId: 'o', principal: { id: 'u' } },
      { home, name: 'acme' },
    )
    const localPath = await writeConfig(
      { url: 'https://acme-local.vobase.app', apiKey: 'k', organizationId: 'o', principal: { id: 'u' } },
      { local: true, cwd: repo, name: 'acme' },
    )
    // From a subdirectory of the repo, the walk should still find the repo-root local.
    expect(await findConfigPath({ home, cwd: sub, flag: 'acme' })).toBe(localPath)
  })

  it('walks up from cwd to find local config at the closest ancestor', async () => {
    const { home, repo, sub } = setupTwoTier()
    const localPath = await writeConfig(
      { url: 'https://acme.vobase.app', apiKey: 'k', organizationId: 'o', principal: { id: 'u' } },
      { local: true, cwd: repo, name: 'acme' },
    )
    expect(await findConfigPath({ home, cwd: sub, flag: 'acme' })).toBe(localPath)
  })

  it('local walk halts at .git (does not climb past the repo root)', async () => {
    const { home, repo, sub } = setupTwoTier()
    const parentDir = join(repo, '..')
    await writeConfig(
      { url: 'https://acme.vobase.app', apiKey: 'k', organizationId: 'o', principal: { id: 'u' } },
      { local: true, cwd: parentDir, name: 'acme' },
    )
    expect(await findConfigPath({ home, cwd: sub, flag: 'acme' })).toBeNull()
  })

  it('loadConfig reads through findConfigPath end-to-end', async () => {
    const { home, repo, sub } = setupTwoTier()
    await writeConfig(
      { url: 'https://acme-local.vobase.app', apiKey: 'vbt_local', organizationId: 'o', principal: { id: 'u' } },
      { local: true, cwd: repo, name: 'acme' },
    )
    const cfg = await loadConfig({ home, cwd: sub, flag: 'acme' })
    expect(cfg?.url).toBe('https://acme-local.vobase.app')
    expect(cfg?.apiKey).toBe('vbt_local')
  })
})
