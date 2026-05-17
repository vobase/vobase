#!/usr/bin/env bun
/**
 * CI lint: typed event bus producer graph.
 *
 * Walks every modules/**\/service\/**\/*.ts and modules/**\/tools\/**\/*.ts file
 * (excluding .test.ts) via ts-morph. For each emit(...) call expression:
 *
 * 1. Resolves the callee symbol declaration file and confirms it is
 *    modules/automations/service/events.ts (filters out socket.emit etc).
 * 2. Asserts arg count === 3 and third arg is an ObjectLiteralExpression
 *    containing a tx property.
 * 3. Cross-checks against EMIT_REGISTRY:
 *    (a) every emit call site must be in the allowlist for its event name
 *        (rogue-producer detection).
 *    (b) every event in eventRegistry must have at least one recorded call
 *        site (orphan detection, lenient in US-004: warns but does not fail).
 *
 * Output style mirrors check-module-shape.ts: errors to stderr, summary
 * line at end, process.exit(1) on errors.
 */

import { join, relative } from 'node:path'
import { ObjectLiteralExpression, Project, SyntaxKind } from 'ts-morph'

import { EMIT_REGISTRY } from './check-emit.config'

const TEMPLATE_ROOT = join(import.meta.dir, '..')

// The canonical declaration file path (relative to TEMPLATE_ROOT) that all
// valid emit calls must resolve to.
const EVENTS_FILE_REL = 'modules/automations/service/events.ts'

export interface CheckEmitResult {
  errors: string[]
  warnings: string[]
}

interface CallSite {
  file: string // relative to TEMPLATE_ROOT
  line: number
  eventName: string
}

/**
 * Core logic, exported for testing with a virtual Project.
 *
 * @param project - ts-morph Project (real tsconfig-backed or virtual)
 * @param registry - EMIT_REGISTRY map
 * @param eventsFileRel - relative path of the canonical events file
 * @param templateRoot - absolute path to packages/template/
 */
export function runChecks(params: {
  project: Project
  registry: Record<string, readonly string[]>
  eventsFileRel: string
  templateRoot: string
}): CheckEmitResult {
  const { project, registry, eventsFileRel, templateRoot } = params
  const errors: string[] = []
  const warnings: string[] = []
  const callSites: CallSite[] = []

  const sourceFiles = project.getSourceFiles()

  for (const sf of sourceFiles) {
    const absPath = sf.getFilePath()
    const relPath = relative(templateRoot, absPath).replace(/\\/g, '/')

    // Skip test files
    if (relPath.endsWith('.test.ts') || relPath.includes('__tests__/')) continue

    // Walk module service/ + tools/ + handlers/ + top-level jobs.ts files and
    // the wake/ folder (producers outside modules — e.g. `wake/heartbeat.ts`
    // emits 'cron'). handlers/ + jobs.ts coverage prevents a silent miss when
    // a future producer lands in an HTTP handler or a pg-boss job entrypoint.
    const isTarget =
      /^modules\/[^/]+\/service\//.test(relPath) ||
      /^modules\/[^/]+\/tools\//.test(relPath) ||
      /^modules\/[^/]+\/handlers\//.test(relPath) ||
      /^modules\/[^/]+\/jobs\.ts$/.test(relPath) ||
      /^wake\//.test(relPath)
    if (!isTarget) continue

    const callExprs = sf.getDescendantsOfKind(SyntaxKind.CallExpression)

    for (const call of callExprs) {
      const callee = call.getExpression()
      // Only bare emit(...) identifiers, not foo.emit(...) member calls
      if (callee.getKind() !== SyntaxKind.Identifier) continue
      if (callee.getText() !== 'emit') continue

      // Resolve the symbol to its declaration file. getSymbol() returns the
      // import binding; getAliasedSymbol() follows through to the real declaration.
      const importSym = callee.getSymbol()
      if (!importSym) continue
      const symbol = project.getTypeChecker().getAliasedSymbol(importSym) ?? importSym
      const declarations = symbol.getDeclarations()
      if (declarations.length === 0) continue

      const declFile = declarations[0].getSourceFile().getFilePath()
      const declRel = relative(templateRoot, declFile).replace(/\\/g, '/')

      // Filter: must be our events.ts emit, not socket.emit etc.
      if (declRel !== eventsFileRel) continue

      const line = call.getStartLineNumber()
      const loc = `${relPath}:${line}`

      // Assert: exactly 3 arguments
      const args = call.getArguments()
      if (args.length !== 3) {
        errors.push(`emit(...) at ${loc}: expected 3 arguments (name, payload, { tx }), got ${args.length}`)
        continue
      }

      // Assert: third arg is ObjectLiteralExpression with tx property
      const thirdArg = args[2]
      if (!(thirdArg instanceof ObjectLiteralExpression)) {
        errors.push(`emit(...) at ${loc}: missing or malformed { tx } third argument -- must be an object literal`)
        continue
      }
      const hasTx = thirdArg.getProperties().some((p) => {
        if (p.getKind() === SyntaxKind.PropertyAssignment || p.getKind() === SyntaxKind.ShorthandPropertyAssignment) {
          const nameNode = p.getFirstChildByKind(SyntaxKind.Identifier)
          return nameNode?.getText() === 'tx'
        }
        return false
      })
      if (!hasTx) {
        errors.push(
          `emit(...) at ${loc}: missing or malformed { tx } third argument -- object literal has no tx property`,
        )
        continue
      }

      // Extract the event name from the first string literal argument
      const firstArg = args[0]
      let eventName = '<unknown>'
      if (firstArg.getKind() === SyntaxKind.StringLiteral) {
        // biome-ignore lint/suspicious/noExplicitAny: ts-morph getLiteralText is available at runtime
        eventName = (firstArg as any).getLiteralText?.() ?? firstArg.getText().replace(/['"]/g, '')
      }

      callSites.push({ file: relPath, line, eventName })
    }
  }

  // (a) Rogue-producer check: every call site must be in the allowlist
  for (const site of callSites) {
    const allowed = registry[site.eventName]
    if (!allowed) {
      errors.push(
        `rogue producer: ${site.file}:${site.line} emits '${site.eventName}' but '${site.eventName}' is not in EMIT_REGISTRY`,
      )
      continue
    }
    const inAllowlist = allowed.some((p) => site.file === p || site.file.endsWith(`/${p}`) || p === site.file)
    if (!inAllowlist) {
      errors.push(
        `rogue producer: ${site.file}:${site.line} emits '${site.eventName}' but is not in EMIT_REGISTRY.${site.eventName} allowlist`,
      )
    }
  }

  // (b) Orphan check: every registered event must have at least one call site
  // resolved from the source tree. US-005 flipped this to STRICT — orphans are
  // errors, not warnings (the lenient WARN-and-pass branch was scaffolding for
  // US-004 only, when no producer existed yet for the seeded `cron` event).
  for (const eventName of Object.keys(registry)) {
    const producers = callSites.filter((s) => s.eventName === eventName)
    if (producers.length === 0) {
      errors.push(
        `orphan event: '${eventName}' is registered in eventRegistry but no producer was found in the source tree`,
      )
    }
  }

  return { errors, warnings }
}

// CLI entrypoint -- only runs when executed directly, not when imported by tests

if (import.meta.main) {
  const project = new Project({
    tsConfigFilePath: join(TEMPLATE_ROOT, 'tsconfig.json'),
    skipAddingFilesFromTsConfig: false,
  })

  const result = runChecks({
    project,
    registry: EMIT_REGISTRY,
    eventsFileRel: EVENTS_FILE_REL,
    templateRoot: TEMPLATE_ROOT,
  })

  for (const w of result.warnings) {
    console.warn(w)
  }

  if (result.errors.length > 0) {
    console.error('\ncheck-emit: FAILED\n')
    for (const err of result.errors) {
      console.error(`  ${err}`)
    }
    console.error(`\n${result.errors.length} error(s) found.`)
    process.exit(1)
  }

  if (result.warnings.length === 0) {
    console.log('check-emit: OK')
  }

  process.exit(0)
}
