/**
 * Unit test: all channel verbs register correctly with expected audience tiers.
 */

import { describe, expect, test } from 'bun:test'

import { channelsDoctorVerb } from './channels-doctor'
import { channelsInstanceShowVerb } from './channels-instance-show'
import { channelsListVerb } from './channels-list'
import { channelsTemplatesSyncVerb } from './channels-templates-sync'

describe('channels verbs registration', () => {
  test('channelsListVerb has name and audience', () => {
    expect(channelsListVerb.name).toBe('channels list')
    expect(channelsListVerb.audience).toBe('staff')
  })

  test('channelsDoctorVerb has name and audience', () => {
    expect(channelsDoctorVerb.name).toBe('channels doctor')
    expect(channelsDoctorVerb.audience).toBe('staff')
  })

  test('channelsTemplatesSyncVerb has name and audience=admin', () => {
    expect(channelsTemplatesSyncVerb.name).toBe('channels templates sync')
    expect(channelsTemplatesSyncVerb.audience).toBe('admin')
  })

  test('channelsInstanceShowVerb has name and audience', () => {
    expect(channelsInstanceShowVerb.name).toBe('channels instance show')
    expect(channelsInstanceShowVerb.audience).toBe('staff')
  })

  test('all verbs have body functions', () => {
    for (const verb of [channelsListVerb, channelsDoctorVerb, channelsTemplatesSyncVerb, channelsInstanceShowVerb]) {
      expect(typeof verb.body).toBe('function')
    }
  })
})
