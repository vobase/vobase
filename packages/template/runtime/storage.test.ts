import { rm } from 'node:fs/promises'
import { afterAll, describe, expect, test } from 'bun:test'

import { createStorage } from './storage'

const TEST_BASE = './.data/storage-test-runtime'

describe('runtime/storage', () => {
  afterAll(async () => {
    await rm(TEST_BASE, { recursive: true, force: true })
  })

  test('bucket(name).upload/download round-trip', async () => {
    const storage = createStorage({ STORAGE_BASE_PATH: TEST_BASE })
    const drive = storage.bucket('drive')
    const payload = new TextEncoder().encode('hello drive')
    await drive.upload('contact/abc/quote.pdf', payload)
    expect(await drive.exists('contact/abc/quote.pdf')).toBe(true)
    const back = await drive.download('contact/abc/quote.pdf')
    expect(back).toEqual(payload)
    await drive.delete('contact/abc/quote.pdf')
    expect(await drive.exists('contact/abc/quote.pdf')).toBe(false)
  })

  test('different buckets do not collide', async () => {
    const storage = createStorage({ STORAGE_BASE_PATH: TEST_BASE })
    await storage.bucket('a').upload('file.txt', new Uint8Array([1, 2]))
    await storage.bucket('b').upload('file.txt', new Uint8Array([3, 4]))
    const a = await storage.bucket('a').download('file.txt')
    const b = await storage.bucket('b').download('file.txt')
    expect(Array.from(a)).toEqual([1, 2])
    expect(Array.from(b)).toEqual([3, 4])
  })

  test('leading slash in key is stripped', async () => {
    const storage = createStorage({ STORAGE_BASE_PATH: TEST_BASE })
    const bucket = storage.bucket('drive')
    await bucket.upload('/leading/slash.txt', new TextEncoder().encode('x'))
    expect(await bucket.exists('leading/slash.txt')).toBe(true)
  })
})
