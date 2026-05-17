import { describe, expect, it } from 'bun:test'

import { lintMintMagicLinkImports } from './check-module-shape'

// Sample import lines to test the regex against
const VIOLATION_LINE = `import { mintMagicLink } from '@auth/magic-link'`
const VIOLATION_LINE_PATH = `import { mintMagicLink } from '../../auth/magic-link'`
const OTHER_EXPORT_LINE = `import { magicLinkCaptor } from '@auth/magic-link'`
const VIOLATION_MULTI = `import { mintMagicLink, magicLinkCaptor } from '@auth/magic-link'`

describe('mint-magic-link-import-boundary', () => {
  describe('violation in wake/ files', () => {
    it('flags mintMagicLink import in wake/trigger.ts', () => {
      const errs = lintMintMagicLinkImports('wake/trigger.ts', [VIOLATION_LINE])
      expect(errs).toHaveLength(1)
      expect(errs[0]).toContain('mintMagicLink import disallowed from wake/trigger.ts')
      expect(errs[0]).toContain('Principle 6')
    })

    it('flags mintMagicLink import in wake/build-base.ts', () => {
      const errs = lintMintMagicLinkImports('wake/build-base.ts', [VIOLATION_LINE])
      expect(errs).toHaveLength(1)
    })

    it('flags path-based import (../../auth/magic-link) in wake/ files', () => {
      const errs = lintMintMagicLinkImports('wake/trigger.ts', [VIOLATION_LINE_PATH])
      expect(errs).toHaveLength(1)
    })

    it('flags multi-symbol import that includes mintMagicLink', () => {
      const errs = lintMintMagicLinkImports('wake/trigger.ts', [VIOLATION_MULTI])
      expect(errs).toHaveLength(1)
    })
  })

  describe('violation in non-allowed modules/ files', () => {
    it('flags mintMagicLink import in messaging/service/notes.ts', () => {
      const errs = lintMintMagicLinkImports('modules/messaging/service/notes.ts', [VIOLATION_LINE])
      expect(errs).toHaveLength(1)
      expect(errs[0]).toContain('modules/messaging/service/notes.ts')
    })

    it('flags mintMagicLink import in contacts/service/upsert.ts', () => {
      const errs = lintMintMagicLinkImports('modules/contacts/service/upsert.ts', [VIOLATION_LINE])
      expect(errs).toHaveLength(1)
    })

    it('does NOT flag import of other exports from auth/magic-link', () => {
      // Only mintMagicLink is gated — magicLinkCaptor, types, etc. are fine.
      const errs = lintMintMagicLinkImports('modules/messaging/service/notes.ts', [OTHER_EXPORT_LINE])
      expect(errs).toHaveLength(0)
    })

    it('does NOT flag comment lines', () => {
      const errs = lintMintMagicLinkImports('modules/messaging/service/notes.ts', [
        `// import { mintMagicLink } from '@auth/magic-link'`,
      ])
      expect(errs).toHaveLength(0)
    })
  })

  describe('allowed files pass without error', () => {
    it('allows modules/team/service/staff-ping.ts', () => {
      const errs = lintMintMagicLinkImports('modules/team/service/staff-ping.ts', [VIOLATION_LINE])
      expect(errs).toHaveLength(0)
    })

    it('allows modules/automations/service/admin-alert.ts', () => {
      const errs = lintMintMagicLinkImports('modules/automations/service/admin-alert.ts', [VIOLATION_LINE])
      expect(errs).toHaveLength(0)
    })

    it('allows modules/automations/service/dispatcher.ts', () => {
      const errs = lintMintMagicLinkImports('modules/automations/service/dispatcher.ts', [VIOLATION_LINE])
      expect(errs).toHaveLength(0)
    })
  })

  describe('multi-line files', () => {
    it('catches violation on a specific line and reports correct line number', () => {
      const lines = [
        `import { logger } from '@vobase/core'`,
        `import { mintMagicLink } from '@auth/magic-link'`,
        `export function foo() {}`,
      ]
      const errs = lintMintMagicLinkImports('modules/agents/service/threads.ts', lines)
      expect(errs).toHaveLength(1)
      expect(errs[0]).toContain(':2') // line 2 (1-indexed)
    })

    it('returns empty for a clean file with only non-mintMagicLink imports', () => {
      const lines = [
        `import { logger } from '@vobase/core'`,
        `import { magicLinkCaptor } from '@auth/magic-link'`,
        `export function foo() {}`,
      ]
      const errs = lintMintMagicLinkImports('modules/agents/service/threads.ts', lines)
      expect(errs).toHaveLength(0)
    })
  })
})
