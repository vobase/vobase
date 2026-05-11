/**
 * phone.test.ts — table-driven tests for normalizeWaId (tenant side).
 *
 * Reads the shared `tests/fixtures/wa-id-normalize.json` parity contract.
 * The byte-equivalent file lives in vobase-platform at
 * `db/fixtures/wa-id-normalize.json`; both sides of the wire contract must
 * validate against the same cases, so any drift fails simultaneously on
 * both repos' next CI run.
 */

import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

import { normalizeWaId } from './phone'

interface Fixture {
  valid: Array<{ input: string; output: string; case: string }>
  invalid: Array<{ input: string; case: string }>
}

const fixturePath = join(import.meta.dir, '..', '..', '..', 'tests', 'fixtures', 'wa-id-normalize.json')
const fixture = (await Bun.file(fixturePath).json()) as Fixture

describe('normalizeWaId — valid cases', () => {
  for (const { input, output, case: name } of fixture.valid) {
    test(name, () => {
      expect(normalizeWaId(input)).toBe(output)
    })
  }
})

describe('normalizeWaId — invalid cases', () => {
  for (const { input, case: name } of fixture.invalid) {
    test(name, () => {
      expect(() => normalizeWaId(input)).toThrow()
    })
  }
})
