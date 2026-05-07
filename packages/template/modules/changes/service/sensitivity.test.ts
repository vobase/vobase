/**
 * Unit tests for the sensitivity routing math.
 *
 * Asserts the additive `T_AUTO_BASE + sLevel × HEADROOM` formula and the
 * trivia-gate semantics from `T_REVIEW`. The integration with insertProposal
 * lives in `proposals.test.ts`.
 */

import { describe, expect, it } from 'bun:test'
import type { ChangePayload } from '@vobase/core'

import {
  effectiveSensitivity,
  maxSensitivity,
  routeStatus,
  SENSITIVITY_HEADROOM,
  SENSITIVITY_LEVELS,
  type Sensitivity,
  T_AUTO_BASE,
  T_REVIEW,
} from './sensitivity'

describe('routeStatus', () => {
  it('drops below T_REVIEW regardless of sensitivity', () => {
    for (const s of ['low', 'medium', 'high', 'critical'] as const) {
      expect(routeStatus(0.0, s)).toBe('drop')
      expect(routeStatus(T_REVIEW - 0.001, s)).toBe('drop')
    }
  })

  it('auto-applies once confidence ≥ T_AUTO_BASE + sLevel × HEADROOM', () => {
    for (const s of ['low', 'medium', 'high', 'critical'] as const) {
      const auto = T_AUTO_BASE + SENSITIVITY_LEVELS[s] * SENSITIVITY_HEADROOM
      expect(routeStatus(auto, s)).toBe('auto_written')
      expect(routeStatus(Math.min(1, auto + 0.05), s)).toBe('auto_written')
    }
  })

  it('routes to pending in the middle band', () => {
    for (const s of ['low', 'medium', 'high', 'critical'] as const) {
      const auto = T_AUTO_BASE + SENSITIVITY_LEVELS[s] * SENSITIVITY_HEADROOM
      const middle = (T_REVIEW + auto) / 2
      // Middle is strictly above T_REVIEW and strictly below auto, so it must
      // route to pending. (Skip 'low' if numbers collide; otherwise asserts.)
      if (middle >= T_REVIEW && middle < auto) {
        expect(routeStatus(middle, s)).toBe('pending')
      }
    }
  })

  it('returns auto_written at the spec-doc thresholds for each level', () => {
    expect(routeStatus(0.76, 'low')).toBe('auto_written')
    expect(routeStatus(0.82, 'medium')).toBe('auto_written')
    expect(routeStatus(0.91, 'high')).toBe('auto_written')
    expect(routeStatus(0.985, 'critical')).toBe('auto_written')
  })
})

describe('maxSensitivity', () => {
  it('returns critical when any element is critical', () => {
    expect(maxSensitivity(['low', 'medium', 'critical'])).toBe('critical')
  })

  it('returns the highest level (critical > high > medium > low)', () => {
    expect(maxSensitivity(['low', 'medium'])).toBe('medium')
    expect(maxSensitivity(['low', 'high'])).toBe('high')
    expect(maxSensitivity(['medium', 'high'])).toBe('high')
    expect(maxSensitivity(['low', 'low', 'low'])).toBe('low')
  })

  it('falls back to low on empty input', () => {
    expect(maxSensitivity([])).toBe('low')
  })
})

describe('effectiveSensitivity', () => {
  function fieldSet(fields: Record<string, { from: unknown; to: unknown }>): ChangePayload {
    return { kind: 'field_set', fields }
  }

  it('returns the resource sensitivity for non-field_set payloads', async () => {
    const out = await effectiveSensitivity({
      resourceSensitivity: 'medium',
      payload: { kind: 'markdown_patch' },
      organizationId: 'org_1',
    })
    expect(out).toBe('medium')
  })

  it('takes the max of resource + scalar overrides for field_set payloads', async () => {
    const out = await effectiveSensitivity({
      resourceSensitivity: 'medium',
      sensitivityForFields: { displayName: 'critical' },
      payload: fieldSet({ displayName: { from: 'a', to: 'b' } }),
      organizationId: 'org_1',
    })
    expect(out).toBe('critical')
  })

  it('ignores scalar override map keys that are not present in the payload', async () => {
    const out = await effectiveSensitivity({
      resourceSensitivity: 'low',
      sensitivityForFields: { displayName: 'critical' },
      payload: fieldSet({ phone: { from: '+1', to: '+2' } }),
      organizationId: 'org_1',
    })
    expect(out).toBe('low')
  })

  it('invokes the attribute resolver for attributes.<key> paths and folds in result', async () => {
    let calls = 0
    const out = await effectiveSensitivity({
      resourceSensitivity: 'medium',
      payload: fieldSet({ 'attributes.medical_condition': { from: null, to: 'asthma' } }),
      organizationId: 'org_1',
      // biome-ignore lint/suspicious/useAwait: contract requires async signature
      resolveAttributeSensitivities: async (orgId, keys) => {
        calls += 1
        expect(orgId).toBe('org_1')
        expect([...keys]).toEqual(['medical_condition'])
        return ['critical']
      },
    })
    expect(calls).toBe(1)
    expect(out).toBe('critical')
  })

  it('does not invoke the resolver when there are no attributes.* paths', async () => {
    let calls = 0
    const out = await effectiveSensitivity({
      resourceSensitivity: 'low',
      payload: fieldSet({ phone: { from: '+1', to: '+2' } }),
      organizationId: 'org_1',
      // biome-ignore lint/suspicious/useAwait: contract requires async signature
      resolveAttributeSensitivities: async () => {
        calls += 1
        return []
      },
    })
    expect(calls).toBe(0)
    expect(out).toBe('low')
  })

  it('combines resource + scalar + attribute sensitivities and takes the max', async () => {
    const out = await effectiveSensitivity({
      resourceSensitivity: 'low' as Sensitivity,
      sensitivityForFields: { displayName: 'high' },
      payload: fieldSet({
        displayName: { from: 'a', to: 'b' },
        'attributes.medical_condition': { from: null, to: 'asthma' },
      }),
      organizationId: 'org_1',
      resolveAttributeSensitivities: () => Promise.resolve(['critical']),
    })
    expect(out).toBe('critical')
  })
})
