// Banned-identifier guards for determinism. systemHash is byte-keyed; any of
// these would byte-divide the prompt across calls or hosts:
//   Date, Date.now           — wall-clock leak
//   Math.random              — RNG leak
//   crypto.randomUUID        — RNG leak
//   process.env, Bun.env     — env leak (per-host)
//   import.meta.env          — bundler env leak
//   os.hostname              — host leak
//   process.version          — runtime-version leak
//   performance.now          — wall-clock leak
//   __dirname, __filename    — install-path leak (per-host)

import { describe, expect, it } from 'bun:test'

import { DEFAULT_MEMORY_SOFT_CAP_CHARS, renderMemoryWithBudget, stripBudgetHeader } from './memory-budget'

const BANNED_IDENTIFIERS: readonly RegExp[] = [
  /\bDate\b/,
  /\bDate\.now\b/,
  /Math\.random/,
  /crypto\.randomUUID/,
  /process\.env/,
  /Bun\.env/,
  /import\.meta\.env/,
  /os\.hostname/,
  /process\.version/,
  /performance\.now/,
  /__dirname/,
  /__filename/,
]

describe('renderMemoryWithBudget', () => {
  it('deterministic — identical inputs produce byte-identical output', () => {
    const a = renderMemoryWithBudget({ scope: 'agent', id: 'a_1', body: 'hello', softCapChars: 8000 })
    const b = renderMemoryWithBudget({ scope: 'agent', id: 'a_1', body: 'hello', softCapChars: 8000 })
    expect(a).toBe(b)
  })

  it('utf16 self-disclosure — header literally contains the (utf16) token between chars= and cap=', () => {
    const out = renderMemoryWithBudget({ scope: 'agent', id: 'a_1', body: 'hi', softCapChars: 8000 })
    expect(out).toContain('chars=2 (utf16) cap=8000')
  })

  it('over flag — over=true iff body.length > softCapChars', () => {
    const under = renderMemoryWithBudget({ scope: 'contact', id: 'c_1', body: 'x'.repeat(10), softCapChars: 100 })
    const exact = renderMemoryWithBudget({ scope: 'contact', id: 'c_1', body: 'x'.repeat(100), softCapChars: 100 })
    const over = renderMemoryWithBudget({ scope: 'contact', id: 'c_1', body: 'x'.repeat(101), softCapChars: 100 })
    expect(under).toContain('over=false')
    expect(exact).toContain('over=false')
    expect(over).toContain('over=true')
  })

  it('emits exactly one trailing newline and no leading whitespace', () => {
    const out = renderMemoryWithBudget({ scope: 'staff', id: 's_1', body: '', softCapChars: 8000 })
    expect(out.startsWith('<!--')).toBe(true)
    expect(out.endsWith('\n')).toBe(true)
    expect(out.match(/\n/g)?.length).toBe(1)
  })

  it('emits chars=0 over=false for empty body', () => {
    const out = renderMemoryWithBudget({ scope: 'agent', id: 'a_1', body: '', softCapChars: 8000 })
    expect(out).toContain('chars=0 (utf16) cap=8000 over=false')
  })

  it('exposes DEFAULT_MEMORY_SOFT_CAP_CHARS as the shared constant', () => {
    expect(DEFAULT_MEMORY_SOFT_CAP_CHARS).toBe(8000)
  })
})

describe('stripBudgetHeader', () => {
  it('strips a leading budget header line', () => {
    const body = '<!-- memory-budget scope=agent id=a_1 chars=10 (utf16) cap=8000 over=false -->\n# Memory\n- x\n'
    expect(stripBudgetHeader(body)).toBe('# Memory\n- x\n')
  })

  it('returns the body unchanged when no header is present', () => {
    expect(stripBudgetHeader('# Memory\n- nothing prepended\n')).toBe('# Memory\n- nothing prepended\n')
  })

  it('does not strip arbitrary HTML comments — only the budget header', () => {
    const body = '<!-- some-other-comment -->\n# Memory\n'
    expect(stripBudgetHeader(body)).toBe(body)
  })

  it('idempotent: render → strip round-trip yields the original body', () => {
    const body = '# Memory\n\n- always lead with price\n'
    const rendered = renderMemoryWithBudget({ scope: 'agent', id: 'a_1', body, softCapChars: 8000 }) + body
    expect(stripBudgetHeader(rendered)).toBe(body)
  })

  it('cycle stability: render → strip → render produces a single header (no stacking)', () => {
    const body = '# Memory\n\n- once\n'
    const r1 = renderMemoryWithBudget({ scope: 'contact', id: 'c_1', body, softCapChars: 8000 }) + body
    const stripped = stripBudgetHeader(r1)
    const r2 = renderMemoryWithBudget({ scope: 'contact', id: 'c_1', body: stripped, softCapChars: 8000 }) + stripped
    const headerCount = (r2.match(/^<!-- memory-budget /gm) ?? []).length
    expect(headerCount).toBe(1)
  })

  it('handles empty body without throwing', () => {
    expect(stripBudgetHeader('')).toBe('')
  })

  it('handles a body that is JUST the header line + newline (no content)', () => {
    const onlyHeader = '<!-- memory-budget scope=staff id=u_1 chars=0 (utf16) cap=8000 over=false -->\n'
    expect(stripBudgetHeader(onlyHeader)).toBe('')
  })
})

describe('memory-budget determinism source guard', () => {
  it('source determinism — wake/memory-budget.ts contains no banned identifiers', async () => {
    const source = await Bun.file(`${import.meta.dir}/memory-budget.ts`).text()
    for (const banned of BANNED_IDENTIFIERS) {
      expect(source).not.toMatch(banned)
    }
  })
})
