/**
 * Unit tests for `auth/captor-pattern.ts` — the generic captor helper shared by
 * `magic-link.ts` and (forthcoming, US-017) `phone-otp.ts`.
 *
 * These tests are pure — no Postgres, no better-auth — they isolate the
 * pending-Map / nonce / timeout / error-wrapping mechanics so a regression in
 * the shared helper surfaces here before any consumer's integration test runs.
 */

import { describe, expect, it } from 'bun:test'

import { CaptorMintError, createCaptor } from './captor-pattern'

class TestMintError extends Error {
  override name = 'TestMintError'
  cause: unknown
  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    this.cause = options?.cause
  }
}

describe('createCaptor', () => {
  it('round-trips payload → nonce → result via sender + deliver', async () => {
    // Capture the nonce the sender receives so the deliver-side can replay it.
    let captured: { payload: { foo: string }; nonce: string } | null = null

    const captor = createCaptor<{ foo: string }, { value: number }>({
      name: 'roundtrip',
      timeoutMs: 1_000,
      sender: async (payload, nonce) => {
        captured = { payload, nonce }
      },
    })

    const mintPromise = captor.mint({ foo: 'bar' })
    // Sender ran synchronously inside mint — captured is populated.
    await Promise.resolve() // give the await opts.sender(...) microtask a tick
    // biome-ignore lint/style/noNonNullAssertion: assigned by the awaited sender
    captor.deliver({ metadata: { nonce: captured!.nonce }, result: { value: 42 } })

    const result = await mintPromise
    expect(result).toEqual({ value: 42 })
    // biome-ignore lint/style/noNonNullAssertion: assigned by the awaited sender
    expect(captured!.payload).toEqual({ foo: 'bar' })
  })

  it('fires captor_timeout within timeoutMs + 500 ms when deliver is never called', async () => {
    const TIMEOUT_MS = 200
    const captor = createCaptor<void, void>({
      name: 'timeout',
      timeoutMs: TIMEOUT_MS,
      errorClass: TestMintError,
      // Sender never delivers — simulates a plugin config regression that
      // skips the sendXxx callback.
      sender: async () => {
        // no-op
      },
    })

    const startMs = Date.now()
    try {
      await captor.mint(undefined)
      throw new Error('mint should have rejected with captor_timeout')
    } catch (err) {
      expect(err).toBeInstanceOf(TestMintError)
      expect((err as TestMintError).message).toBe('captor_timeout')
    }
    const elapsed = Date.now() - startMs
    expect(elapsed).toBeGreaterThanOrEqual(TIMEOUT_MS)
    // PRD: "fires within timeoutMs + 500 ms" — give a comfortable budget.
    expect(elapsed).toBeLessThan(TIMEOUT_MS + 500)
  })

  it('throws <Name>MintError("captor_unknown_nonce") on deliver for a nonce that never existed', () => {
    const captor = createCaptor<void, void>({
      name: 'unknown',
      timeoutMs: 1_000,
      errorClass: TestMintError,
      sender: async () => {},
    })

    expect(() => {
      captor.deliver({ metadata: { nonce: 'never-minted-nonce' }, result: undefined })
    }).toThrow(TestMintError)

    try {
      captor.deliver({ metadata: { nonce: 'never-minted-2' }, result: undefined })
    } catch (err) {
      expect(err).toBeInstanceOf(TestMintError)
      expect((err as TestMintError).message).toBe('captor_unknown_nonce')
    }
  })

  it('falls back to CaptorMintError when no errorClass is supplied', () => {
    const captor = createCaptor<void, void>({
      name: 'default-error',
      timeoutMs: 1_000,
      sender: async () => {},
    })

    try {
      captor.deliver({ metadata: { nonce: 'whatever' }, result: undefined })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(CaptorMintError)
      expect((err as CaptorMintError).message).toBe('captor_unknown_nonce')
    }
  })

  it('post-timeout deliver is a silent no-op (no throw)', async () => {
    const TIMEOUT_MS = 100
    let capturedNonce: string | null = null
    const captor = createCaptor<void, { ok: true }>({
      name: 'post-timeout',
      timeoutMs: TIMEOUT_MS,
      errorClass: TestMintError,
      sender: async (_payload, nonce) => {
        capturedNonce = nonce
      },
    })

    // First mint times out.
    try {
      await captor.mint(undefined)
      throw new Error('expected captor_timeout')
    } catch (err) {
      expect((err as Error).message).toBe('captor_timeout')
    }
    expect(capturedNonce).not.toBeNull()

    // Now deliver on the timed-out nonce — must be a silent no-op.
    expect(() => {
      // biome-ignore lint/style/noNonNullAssertion: asserted above
      captor.deliver({ metadata: { nonce: capturedNonce! }, result: { ok: true } })
    }).not.toThrow()
  })

  it('ignores deliver with missing/undefined nonce in metadata (does not throw)', () => {
    const captor = createCaptor<void, void>({
      name: 'no-nonce',
      timeoutMs: 1_000,
      errorClass: TestMintError,
      sender: async () => {},
    })

    // metadata = undefined
    expect(() => {
      captor.deliver({ metadata: undefined, result: undefined })
    }).not.toThrow()

    // metadata = {} (no nonce key)
    expect(() => {
      captor.deliver({ metadata: {}, result: undefined })
    }).not.toThrow()

    // metadata.nonce = number (wrong type)
    expect(() => {
      captor.deliver({ metadata: { nonce: 123 } as unknown as { nonce: string }, result: undefined })
    }).not.toThrow()
  })

  it('wraps sender errors in <Name>MintError("captor_send_failed") with original cause', async () => {
    const captor = createCaptor<void, void>({
      name: 'send-fail',
      timeoutMs: 1_000,
      errorClass: TestMintError,
      sender: async () => {
        throw new Error('upstream-blew-up')
      },
    })

    try {
      await captor.mint(undefined)
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(TestMintError)
      const mintErr = err as TestMintError
      expect(mintErr.message).toBe('captor_send_failed')
      expect((mintErr.cause as Error).message).toBe('upstream-blew-up')
    }
  })

  it('isolates 50 concurrent mints — every nonce unique, every result delivered to the right awaiter', async () => {
    const N = 50
    const noncesByCallIndex = new Map<number, string>()
    let nextIdx = 0

    const captor = createCaptor<{ idx: number }, { idx: number }>({
      name: 'concurrent',
      timeoutMs: 2_000,
      errorClass: TestMintError,
      sender: async (payload, nonce) => {
        noncesByCallIndex.set(payload.idx, nonce)
        nextIdx++
      },
    })

    // Fire N mints concurrently; deliver each on a microtask.
    const mintPromises = Array.from({ length: N }, (_, idx) => captor.mint({ idx }))

    // Wait a tick so every sender has registered its nonce.
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
    expect(nextIdx).toBe(N)

    // All nonces must be unique (else there's a collision risk).
    const nonces = new Set(noncesByCallIndex.values())
    expect(nonces.size).toBe(N)

    // Deliver each result on its own nonce; the matching mintPromise must resolve
    // with the matching `idx` value (proves the resolver wiring).
    for (let i = 0; i < N; i++) {
      const nonce = noncesByCallIndex.get(i)
      // biome-ignore lint/style/noNonNullAssertion: populated by sender above
      captor.deliver({ metadata: { nonce: nonce! }, result: { idx: i } })
    }

    const results = await Promise.all(mintPromises)
    for (let i = 0; i < N; i++) {
      expect(results[i]).toEqual({ idx: i })
    }
  })

  it('isolates two captors built from the same module (independent pending Maps)', async () => {
    const captorA = createCaptor<{ tag: 'A' }, string>({
      name: 'isolated-A',
      timeoutMs: 1_000,
      errorClass: TestMintError,
      sender: async () => {},
    })
    const captorB = createCaptor<{ tag: 'B' }, string>({
      name: 'isolated-B',
      timeoutMs: 1_000,
      errorClass: TestMintError,
      sender: async () => {},
    })

    // Capture nonces emitted by each sender.
    let nonceA: string | null = null
    let nonceB: string | null = null
    const captorA2 = createCaptor<void, string>({
      name: 'A2',
      timeoutMs: 1_000,
      errorClass: TestMintError,
      sender: async (_p, nonce) => {
        nonceA = nonce
      },
    })
    const captorB2 = createCaptor<void, string>({
      name: 'B2',
      timeoutMs: 1_000,
      errorClass: TestMintError,
      sender: async (_p, nonce) => {
        nonceB = nonce
      },
    })

    const promiseA = captorA2.mint(undefined)
    const promiseB = captorB2.mint(undefined)
    await new Promise<void>((resolve) => setTimeout(resolve, 5))

    // Delivering nonceA to captorB2 must throw `captor_unknown_nonce` —
    // independence proof.
    expect(() => {
      // biome-ignore lint/style/noNonNullAssertion: assigned by sender
      captorB2.deliver({ metadata: { nonce: nonceA! }, result: 'wrong-captor' })
    }).toThrow(TestMintError)

    // Now deliver correctly so awaiters resolve.
    // biome-ignore lint/style/noNonNullAssertion: assigned by sender
    captorA2.deliver({ metadata: { nonce: nonceA! }, result: 'value-A' })
    // biome-ignore lint/style/noNonNullAssertion: assigned by sender
    captorB2.deliver({ metadata: { nonce: nonceB! }, result: 'value-B' })

    expect(await promiseA).toBe('value-A')
    expect(await promiseB).toBe('value-B')

    // Reference unused captor variables so biome doesn't flag them; they exist
    // to document that creating sibling captors does not interfere with this
    // pair's behavior.
    void captorA
    void captorB
  })
})
