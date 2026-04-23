import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { z } from 'zod'

const fetchMock = mock(async (_url: string, _opts?: RequestInit): Promise<Response> => {
  return new Response(JSON.stringify({ ok: true }), { status: 200 })
})

globalThis.fetch = fetchMock as unknown as typeof fetch

import { postSettings } from '../use-settings-save'

const _schema = z.object({ displayName: z.string().optional() })

describe('postSettings — happy path', () => {
  beforeEach(() => fetchMock.mockClear())

  it('POSTs to /api/settings/{section} with JSON body', async () => {
    await postSettings('profile', { displayName: 'Alice' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/settings/profile')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body as string)).toEqual({ displayName: 'Alice' })
  })

  it('resolves without error on 200', async () => {
    await expect(postSettings('profile', {})).resolves.toBeUndefined()
  })
})

describe('postSettings — error path', () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: 'invalid_body' }), { status: 400 }))
  })

  it('throws on non-ok response', async () => {
    await expect(postSettings('profile', { email: 'bad' })).rejects.toThrow('invalid_body')
  })

  it('throws generic message when error field absent', async () => {
    fetchMock.mockImplementation(async () => new Response('{}', { status: 500 }))
    await expect(postSettings('profile', {})).rejects.toThrow('Failed to save settings')
  })
})
