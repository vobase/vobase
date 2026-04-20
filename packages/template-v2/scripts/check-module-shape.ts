#!/usr/bin/env bun
/**
 * CI lint — enforces module shape.
 *
 * Checks:
 * 1. Every required file exists in each module dir (R2 — from module-shape.ts)
 * 2. No handler file exceeds MAX_HANDLER_RAW_LOC raw lines (N6)
 * 3. Every handlers/index.ts mounts at least one Hono route (R5)
 * 4. No module imports from another module's schema.ts
 * 5. No applyTransition calls outside state.ts
 * 6. Every README.md has YAML frontmatter with required keys
 *
 * Exits 0 on success, non-zero with file:line-accurate errors on failure.
 */

import { join } from 'node:path'
import {
  MAX_HANDLER_RAW_LOC,
  REQUIRED_MODULE_FILES,
  REQUIRED_README_FRONTMATTER,
} from '../server/contracts/module-shape'

const MODULES_DIR = join(import.meta.dir, '..', 'modules')

// Hono route method patterns
const HONO_ROUTE_RE = /\.(get|post|put|delete|patch|all|on)\s*\(|app\.(get|post|put|delete|patch|all|on)\s*\(/

// Cross-module schema import: import ... from '...@modules/<other>/schema' or '../../<other>/schema'
const CROSS_SCHEMA_RE = /from\s+['"](?:@modules\/[^/'"]+\/schema|\.\.\/[^/'"]+\/schema)['"]/

// applyTransition usage
const APPLY_TRANSITION_RE = /applyTransition\s*\(/

interface LintError {
  file: string
  line?: number
  message: string
}

const errors: LintError[] = []

function fail(file: string, message: string, line?: number): void {
  errors.push({ file, message, line })
}

async function getModuleDirs(): Promise<string[]> {
  const { readdirSync, existsSync } = await import('node:fs')
  const topLevel = readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()

  const results: string[] = []
  for (const name of topLevel) {
    if (name === 'channels') {
      // Recurse one level into channels/ to discover channel adapter modules.
      const channelsDir = join(MODULES_DIR, 'channels')
      const children = readdirSync(channelsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
      for (const child of children) {
        if (existsSync(join(channelsDir, child, 'module.ts'))) {
          results.push(`channels/${child}`)
        }
      }
    } else if (existsSync(join(MODULES_DIR, name, 'module.ts'))) {
      results.push(name)
    }
  }
  return results
}

async function fileExists(path: string): Promise<boolean> {
  return Bun.file(path).exists()
}

async function readLines(path: string): Promise<string[]> {
  const text = await Bun.file(path).text()
  return text.split('\n')
}

async function checkRequiredFiles(moduleName: string, moduleDir: string): Promise<void> {
  for (const required of REQUIRED_MODULE_FILES) {
    const fullPath = join(moduleDir, required)
    if (!(await fileExists(fullPath))) {
      fail(fullPath, `module "${moduleName}" is missing required file: ${required}`)
    }
  }
}

async function checkHandlerLoc(moduleName: string, moduleDir: string): Promise<void> {
  const handlersDir = join(moduleDir, 'handlers')
  // Bun.file().exists() returns false for directories — use glob scan directly
  const glob = new Bun.Glob('**/*.ts')
  for await (const entry of glob.scan({ cwd: handlersDir })) {
    const fullPath = join(handlersDir, entry)
    const lines = await readLines(fullPath)
    const loc = lines.length
    if (loc > MAX_HANDLER_RAW_LOC) {
      fail(
        fullPath,
        `module "${moduleName}" handler file exceeds ${MAX_HANDLER_RAW_LOC} raw lines (got ${loc}): handlers/${entry}`,
        loc,
      )
    }
  }
}

async function checkHandlerHasRoutes(moduleName: string, moduleDir: string): Promise<void> {
  const indexPath = join(moduleDir, 'handlers', 'index.ts')
  if (!(await fileExists(indexPath))) return

  const text = await Bun.file(indexPath).text()
  if (!HONO_ROUTE_RE.test(text)) {
    fail(
      indexPath,
      `module "${moduleName}" handlers/index.ts mounts zero Hono routes (R5 — must have at least GET /health)`,
    )
  }
}

async function checkNoCrossSchemaImports(moduleName: string, moduleDir: string): Promise<void> {
  // Check all .ts files under this module (except schema.ts itself)
  const glob = new Bun.Glob('**/*.ts')
  for await (const entry of glob.scan({ cwd: moduleDir })) {
    if (entry === 'schema.ts') continue
    const fullPath = join(moduleDir, entry)
    const lines = await readLines(fullPath)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (CROSS_SCHEMA_RE.test(line)) {
        // Allow importing own schema (same module)
        // The pattern already excludes own schema because it requires a different module path
        // Double-check: exclude self-references within same module
        const ownSchemaPatterns = [`@modules/${moduleName}/schema`, `../schema`, `./schema`]
        const isOwn = ownSchemaPatterns.some((p) => line.includes(p))
        if (!isOwn) {
          fail(
            fullPath,
            `module "${moduleName}" imports from another module's schema.ts (forbidden — use ports instead): ${line.trim()}`,
            i + 1,
          )
        }
      }
    }
  }
}

async function checkApplyTransitionOnlyInStateTs(moduleName: string, moduleDir: string): Promise<void> {
  const glob = new Bun.Glob('**/*.ts')
  for await (const entry of glob.scan({ cwd: moduleDir })) {
    if (entry === 'state.ts') continue
    const fullPath = join(moduleDir, entry)
    const lines = await readLines(fullPath)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (APPLY_TRANSITION_RE.test(line)) {
        // Allow import statements — only flag actual calls
        if (!line.trim().startsWith('import') && !line.trim().startsWith('//')) {
          fail(
            fullPath,
            `module "${moduleName}" calls applyTransition() outside state.ts (state transitions belong in state.ts)`,
            i + 1,
          )
        }
      }
    }
  }
}

async function checkReadmeFrontmatter(moduleName: string, moduleDir: string): Promise<void> {
  const readmePath = join(moduleDir, 'README.md')
  if (!(await fileExists(readmePath))) return // missing file already caught by checkRequiredFiles

  const text = await Bun.file(readmePath).text()
  if (!text.startsWith('---')) {
    fail(
      readmePath,
      `module "${moduleName}" README.md must start with YAML frontmatter (---) containing: ${REQUIRED_README_FRONTMATTER.join(', ')}`,
    )
    return
  }

  const endFm = text.indexOf('---', 3)
  if (endFm === -1) {
    fail(readmePath, `module "${moduleName}" README.md YAML frontmatter is not closed with ---`)
    return
  }

  const frontmatter = text.slice(3, endFm)
  for (const key of REQUIRED_README_FRONTMATTER) {
    // Accept "key:" or "key :" patterns
    if (!new RegExp(`^${key}\\s*:`, 'm').test(frontmatter)) {
      fail(readmePath, `module "${moduleName}" README.md frontmatter is missing required key: "${key}"`)
    }
  }
}

async function lintModule(moduleName: string): Promise<void> {
  const moduleDir = join(MODULES_DIR, moduleName)
  await Promise.all([
    checkRequiredFiles(moduleName, moduleDir),
    checkHandlerLoc(moduleName, moduleDir),
    checkHandlerHasRoutes(moduleName, moduleDir),
    checkNoCrossSchemaImports(moduleName, moduleDir),
    checkApplyTransitionOnlyInStateTs(moduleName, moduleDir),
    checkReadmeFrontmatter(moduleName, moduleDir),
  ])
}

async function main(): Promise<void> {
  const moduleDirs = await getModuleDirs()

  if (moduleDirs.length === 0) {
    console.error('check-module-shape: no module directories found under modules/')
    process.exit(1)
  }

  console.log(`check-module-shape: linting ${moduleDirs.length} module(s): ${moduleDirs.join(', ')}`)

  await Promise.all(moduleDirs.map((name) => lintModule(name)))

  if (errors.length > 0) {
    console.error('\ncheck-module-shape: FAILED\n')
    for (const err of errors) {
      const loc = err.line != null ? `:${err.line}` : ''
      console.error(`  ${err.file}${loc}: ${err.message}`)
    }
    console.error(`\n${errors.length} error(s) found.`)
    process.exit(1)
  }

  console.log('check-module-shape: all modules OK')
  process.exit(0)
}

await main()
