/**
 * Unit tests for `parseSmbAppStateSync`, driven by a real captured
 * `smb_app_state_sync` payload.
 */
import { describe, expect, it } from 'bun:test'

import { parseSmbAppStateSync } from './parse-contacts-sync'

const REAL_CAPTURE = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '1510232487148821',
      changes: [
        {
          field: 'smb_app_state_sync',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '6589765873', phone_number_id: '1184057261457861' },
            state_sync: [
              { type: 'contact', contact: { full_name: 'Carl Luo', phone_number: '6583792777' }, action: 'add' },
              { type: 'contact', contact: { full_name: 'Yiyuan', phone_number: '6589523447' }, action: 'add' },
            ],
          },
        },
      ],
    },
  ],
}

describe('parseSmbAppStateSync', () => {
  it('extracts saved contact names + phones from the address-book sync', () => {
    expect(parseSmbAppStateSync(REAL_CAPTURE)).toEqual([
      { phone: '6583792777', fullName: 'Carl Luo', action: 'add' },
      { phone: '6589523447', fullName: 'Yiyuan', action: 'add' },
    ])
  })

  it('falls back to first_name and flags removals', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'smb_app_state_sync',
              value: {
                state_sync: [
                  { type: 'contact', contact: { first_name: 'Jh', phone_number: '6590055216' }, action: 'add' },
                  { type: 'contact', contact: { phone_number: '6581822494' }, action: 'remove' },
                ],
              },
            },
          ],
        },
      ],
    }
    expect(parseSmbAppStateSync(payload)).toEqual([
      { phone: '6590055216', fullName: 'Jh', action: 'add' },
      { phone: '6581822494', fullName: null, action: 'remove' },
    ])
  })

  it('returns [] for non-contacts-sync or junk payloads', () => {
    expect(parseSmbAppStateSync(null)).toEqual([])
    expect(
      parseSmbAppStateSync({
        object: 'whatsapp_business_account',
        entry: [{ changes: [{ field: 'history', value: {} }] }],
      }),
    ).toEqual([])
  })
})
