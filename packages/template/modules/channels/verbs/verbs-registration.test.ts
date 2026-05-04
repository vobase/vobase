/**
 * Unit test: all channel verbs register correctly with expected audience tiers.
 */

import { describe, expect, test } from 'bun:test'

import { channelsInstanceShowVerb } from './channels-instance-show'
import { channelsListVerb } from './channels-list'

describe('channels verbs registration', () => {
  test('channelsListVerb has name and audience', () => {
    expect(channelsListVerb.name).toBe('channels list')
    expect(channelsListVerb.audience).toBe('staff')
  })

  test('channelsInstanceShowVerb has name and audience', () => {
    expect(channelsInstanceShowVerb.name).toBe('channels instance show')
    expect(channelsInstanceShowVerb.audience).toBe('staff')
  })

  test('all verbs have body functions', () => {
    for (const verb of [channelsListVerb, channelsInstanceShowVerb]) {
      expect(typeof verb.body).toBe('function')
    }
  })
})
