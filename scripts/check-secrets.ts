#!/usr/bin/env bun
/**
 * Pre-commit secret scan.
 *
 *   bun run scripts/check-secrets.ts            # scan staged-for-commit files
 *   bun run scripts/check-secrets.ts --all      # scan everything tracked by git
 *
 * Strategy:
 *
 *   1. If `gitleaks` is on $PATH, shell out to it with `.gitleaks.toml`.
 *      This is the preferred fast path; it understands the full TOML config.
 *
 *   2. Otherwise, fall back to a built-in regex scanner that mirrors the
 *      `[[rules]]` blocks in `.gitleaks.toml`. The fallback is slower per byte
 *      but only ever runs over the staged diff, so latency is negligible.
 *
 * Allowlist: paths under `legacy/template-v1/`, `tests/`, `*.example*`, and
 * obvious placeholder strings (`change-me`, `your-secret`, `xxxx`, …) are
 * skipped to keep the scan signal:noise high. The full allowlist lives in
 * `.gitleaks.toml`; the fallback scanner reads the same file.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '..')
const CONFIG_PATH = resolve(REPO_ROOT, '.gitleaks.toml')

interface Rule {
  id: string
  description: string
  regex: RegExp
}

interface Allowlist {
  paths: RegExp[]
  regexes: RegExp[]
}

interface Finding {
  file: string
  rule: string
  line: number
  match: string
}

async function loadConfig(): Promise<{ rules: Rule[]; allowlist: Allowlist }> {
  const text = await readFile(CONFIG_PATH, 'utf8')
  const rules: Rule[] = []
  const allowlist: Allowlist = { paths: [], regexes: [] }

  const blocks = text.split(/\n(?=\[)/g)
  for (const block of blocks) {
    if (block.startsWith('[[rules]]')) {
      const id = matchString(block, /^id\s*=\s*"([^"]+)"/m)
      const description = matchString(block, /^description\s*=\s*"([^"]+)"/m) ?? id ?? ''
      const regexLiteral = matchString(block, /^regex\s*=\s*'''([\s\S]*?)'''/m)
      if (id && regexLiteral) {
        // Strip inline (?i) and move it to the RegExp flags argument instead.
        const hasInlineI = regexLiteral.startsWith('(?i)')
        const pattern = hasInlineI ? regexLiteral.slice(4) : regexLiteral
        rules.push({ id, description, regex: new RegExp(pattern, hasInlineI ? 'i' : undefined) })
      }
    } else if (block.startsWith('[allowlist]')) {
      const pathArrayMatch = block.match(/paths\s*=\s*\[([\s\S]*?)\]/m)
      if (pathArrayMatch) {
        for (const m of pathArrayMatch[1].matchAll(/'''([^']+)'''/g)) {
          allowlist.paths.push(new RegExp(m[1]))
        }
      }
      const regexArrayMatch = block.match(/regexes\s*=\s*\[([\s\S]*?)\]/m)
      if (regexArrayMatch) {
        for (const m of regexArrayMatch[1].matchAll(/'''([^']+)'''/g)) {
          allowlist.regexes.push(new RegExp(m[1]))
        }
      }
    }
  }
  return { rules, allowlist }
}

function matchString(text: string, re: RegExp): string | undefined {
  const m = text.match(re)
  return m?.[1]
}

function gitleaksAvailable(): boolean {
  try {
    const out = Bun.spawnSync(['gitleaks', 'version'], { stdout: 'pipe', stderr: 'pipe' })
    return out.exitCode === 0
  } catch {
    return false
  }
}

function listFiles(allMode: boolean): string[] {
  const args = allMode ? ['ls-files'] : ['diff', '--cached', '--name-only', '--diff-filter=ACM']
  const proc = Bun.spawnSync(['git', ...args], { cwd: REPO_ROOT, stdout: 'pipe', stderr: 'pipe' })
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${new TextDecoder().decode(proc.stderr)}`)
  }
  return new TextDecoder()
    .decode(proc.stdout)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

function isAllowedPath(file: string, allowlist: Allowlist): boolean {
  return allowlist.paths.some((re) => re.test(file))
}

function lineFor(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++
  }
  return line
}

async function scanFile(file: string, rules: Rule[], allowlist: Allowlist): Promise<Finding[]> {
  const findings: Finding[] = []
  let text: string
  try {
    text = await readFile(resolve(REPO_ROOT, file), 'utf8')
  } catch {
    return findings
  }
  for (const rule of rules) {
    const flags = rule.regex.flags.includes('g') ? rule.regex.flags : `g${rule.regex.flags}`
    const re = new RegExp(rule.regex.source, flags)
    let m: RegExpExecArray | null
    re.lastIndex = 0
    while ((m = re.exec(text)) !== null) {
      const match = m[0]
      if (allowlist.regexes.some((a) => a.test(match))) continue
      findings.push({
        file,
        rule: rule.id,
        line: lineFor(text, m.index),
        match: match.length > 80 ? `${match.slice(0, 77)}…` : match,
      })
      if (re.lastIndex === m.index) re.lastIndex++
    }
  }
  return findings
}

async function runFallback(allMode: boolean): Promise<number> {
  const { rules, allowlist } = await loadConfig()
  const files = listFiles(allMode).filter((f) => !isAllowedPath(f, allowlist))
  const findings: Finding[] = []
  for (const file of files) {
    findings.push(...(await scanFile(file, rules, allowlist)))
  }
  if (findings.length === 0) {
    console.log(`✓ secret scan clean (${files.length} file(s) scanned, fallback regex engine)`)
    return 0
  }
  console.error(`✗ secret scan: ${findings.length} potential leak(s) detected`)
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  [${f.rule}]  ${f.match}`)
  }
  console.error('')
  console.error('  ↳ if these are placeholders/fixtures, add the path or pattern to .gitleaks.toml [allowlist]')
  console.error('  ↳ to bypass for a single commit (only with explicit user approval), use `git commit --no-verify`')
  return 1
}

function runGitleaks(allMode: boolean): number {
  const args = ['detect', '--config', CONFIG_PATH, '--no-banner', '--redact']
  if (!allMode) args.push('--staged')
  const proc = Bun.spawnSync(['gitleaks', ...args], {
    cwd: REPO_ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  return proc.exitCode ?? 1
}

async function main(): Promise<void> {
  const allMode = process.argv.includes('--all')
  const code = gitleaksAvailable() ? runGitleaks(allMode) : await runFallback(allMode)
  process.exit(code)
}

await main()
