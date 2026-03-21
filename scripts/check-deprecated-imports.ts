/**
 * PostToolUse hook: warn when a file imports deprecated TypeScript symbols.
 *
 * Checks both relative and package imports by resolving to source/.d.ts files,
 * then checking if each imported symbol has @deprecated in its immediately
 * preceding JSDoc block.
 *
 * Usage:
 *   bun run scripts/check-deprecated-imports.ts <file>   — check a single file
 *   bun run scripts/check-deprecated-imports.ts <dir>    — scan all .ts/.tsx files in dir
 *
 * WHY THIS EXISTS:
 * Biome has a `noDeprecatedImports` rule (since v2.2.5) under the `project` domain,
 * but as of v2.4.8 it does NOT work with `declare function` in `.d.ts` files.
 * See: https://github.com/biomejs/biome/issues/7635
 *
 * WHEN TO REMOVE:
 * Once Biome fixes #7635 and `noDeprecatedImports` correctly flags imports of
 * deprecated symbols from npm packages (e.g. `generateObject` from `ai`),
 * this script and its PostToolUse hook in .claude/settings.json can be deleted.
 * The Biome rule is already configured in packages/template/biome.json under
 * `linter.domains.project`.
 */

import { resolve, dirname, extname, join } from "node:path";
import { statSync } from "node:fs";

const TS_EXTS = new Set([".ts", ".tsx", ".js", ".jsx"]);

async function collectFiles(target: string): Promise<string[]> {
	let stat: ReturnType<typeof statSync>;
	try {
		stat = statSync(target);
	} catch {
		return [];
	}

	if (stat.isFile()) {
		return TS_EXTS.has(extname(target)) ? [target] : [];
	}

	if (stat.isDirectory()) {
		const glob = new Bun.Glob("**/*.{ts,tsx}");
		const files: string[] = [];
		for await (const path of glob.scan({ cwd: target, absolute: true })) {
			if (!path.includes("node_modules/") && !path.includes("/dist/")) {
				files.push(path);
			}
		}
		return files;
	}

	return [];
}

const target = resolve(process.argv[2] ?? "");
if (!target) process.exit(0);

const files = await collectFiles(target);
if (files.length === 0) process.exit(0);

interface ImportInfo {
	specifier: string;
	symbols: string[];
}

function extractImports(source: string): ImportInfo[] {
	const results: ImportInfo[] = [];
	// Named imports: import { foo, bar } from "pkg"
	const namedRegex = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
	let match: RegExpExecArray | null;
	while ((match = namedRegex.exec(source)) !== null) {
		const symbols = match[1]
			.split(",")
			.map((s) => s.trim().split(/\s+as\s+/)[0].trim())
			.filter(Boolean);
		results.push({ specifier: match[2], symbols });
	}
	// Default imports: import foo from "pkg"
	const defaultRegex =
		/import\s+([a-zA-Z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/g;
	while ((match = defaultRegex.exec(source)) !== null) {
		results.push({ specifier: match[2], symbols: [match[1]] });
	}
	// Side-effect: import "pkg"
	const sideEffectRegex = /^\s*import\s+['"]([^'"]+)['"]/gm;
	while ((match = sideEffectRegex.exec(source)) !== null) {
		if (!results.some((r) => r.specifier === match![1])) {
			results.push({ specifier: match[1], symbols: [] });
		}
	}
	return results;
}

const TS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];


async function resolveRelative(
	base: string,
	specifier: string,
): Promise<string | null> {
	const resolved = resolve(base, specifier);
	if (extname(resolved) && (await Bun.file(resolved).exists()))
		return resolved;
	for (const e of TS_EXTENSIONS) {
		if (await Bun.file(resolved + e).exists()) return resolved + e;
	}
	for (const e of TS_EXTENSIONS) {
		const idx = resolve(resolved, `index${e}`);
		if (await Bun.file(idx).exists()) return idx;
	}
	return null;
}

async function findNodeModules(from: string): Promise<string | null> {
	let current = from;
	while (current !== "/") {
		const nm = join(current, "node_modules");
		const proc = Bun.spawnSync(["test", "-d", nm]);
		if (proc.exitCode === 0) return nm;
		current = dirname(current);
	}
	return null;
}

async function resolvePackageDts(
	nodeModules: string,
	specifier: string,
): Promise<string | null> {
	const parts = specifier.startsWith("@")
		? specifier.split("/").slice(0, 2)
		: specifier.split("/").slice(0, 1);
	const pkgDir = join(nodeModules, parts.join("/"));
	const pkgJsonFile = Bun.file(join(pkgDir, "package.json"));
	if (!(await pkgJsonFile.exists())) return null;
	try {
		const pkg = await pkgJsonFile.json();
		const typesEntry =
			pkg.types ?? pkg.typings ?? pkg.exports?.["."]?.types;
		if (typesEntry) {
			const p = resolve(pkgDir, typesEntry);
			if (await Bun.file(p).exists()) return p;
		}
		for (const c of [
			"dist/index.d.ts",
			"index.d.ts",
			"dist/index.d.mts",
		]) {
			const p = join(pkgDir, c);
			if (await Bun.file(p).exists()) return p;
		}
	} catch {}
	return null;
}

/**
 * Find the JSDoc block immediately preceding a line index.
 * Returns the JSDoc text if found, or null.
 * "Immediately preceding" means: scanning upward from the line before the
 * declaration, allowing only whitespace/comment lines, until we find the
 * closing and opening of a JSDoc block.
 */
function getJsDocBefore(lines: string[], declLineIdx: number): string | null {
	let endIdx = -1;
	// Walk backwards to find the end of a JSDoc comment (*/)
	for (let i = declLineIdx - 1; i >= 0; i--) {
		const trimmed = lines[i].trim();
		if (trimmed === "") continue; // skip blank lines
		if (trimmed.endsWith("*/")) {
			endIdx = i;
			break;
		}
		// If we hit a non-blank, non-comment-end line, there's no JSDoc
		break;
	}
	if (endIdx === -1) return null;

	// Walk backwards from endIdx to find the start of the JSDoc (/**)
	for (let i = endIdx; i >= 0; i--) {
		if (lines[i].includes("/**")) {
			return lines.slice(i, endIdx + 1).join("\n");
		}
	}
	return null;
}

/**
 * Check if specific symbols have @deprecated in their immediately preceding JSDoc.
 */
function checkSymbolDeprecations(
	source: string,
	symbols: string[],
): Map<string, string> {
	const deprecated = new Map<string, string>();
	const lines = source.split("\n");

	for (const symbol of symbols) {
		const escapedSymbol = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const declPattern = new RegExp(
			`(?:export\\s+)?(?:declare\\s+)?(?:function|const|class|interface|type|enum|var|let)\\s+${escapedSymbol}\\b`,
		);

		for (let i = 0; i < lines.length; i++) {
			if (declPattern.test(lines[i])) {
				const jsdoc = getJsDocBefore(lines, i);
				if (jsdoc) {
					const depMatch = jsdoc.match(
						/@deprecated\s*(.*?)(?:\n|\*\/)/,
					);
					if (depMatch) {
						const reason =
							depMatch[1]
								?.replace(/\*\/$/, "")
								.replace(/\s*\*\s*$/, "")
								.trim() || "Deprecated.";
						deprecated.set(symbol, reason);
					}
				}
				break; // Only check first declaration of this symbol
			}
		}
	}
	return deprecated;
}

function checkModuleDeprecation(source: string): string | null {
	const header = source.split("\n").slice(0, 30).join("\n");
	const match = header.match(/@deprecated\s*(.*?)(?:\n|\*\/)/);
	return match
		? match[1]?.replace(/\*\/$/, "").trim() || "This module is deprecated."
		: null;
}

// --- Main ---

async function checkFile(filePath: string): Promise<string[]> {
	const content = await Bun.file(filePath).text();
	const dir = dirname(filePath);
	const imports = extractImports(content);
	if (imports.length === 0) return [];

	const nodeModules = await findNodeModules(dir);
	const warnings: string[] = [];

	for (const imp of imports) {
		const isRelative = imp.specifier.startsWith(".");

		let resolvedPath: string | null = null;
		if (isRelative) {
			resolvedPath = await resolveRelative(dir, imp.specifier);
		} else if (nodeModules) {
			resolvedPath = await resolvePackageDts(nodeModules, imp.specifier);
		}
		if (!resolvedPath) continue;

		const source = await Bun.file(resolvedPath).text();

		if (imp.symbols.length === 0) {
			const reason = checkModuleDeprecation(source);
			if (reason) {
				warnings.push(
					`${filePath}: Deprecated module "${imp.specifier}" → ${reason}`,
				);
			}
			continue;
		}

		const deprecated = checkSymbolDeprecations(source, imp.symbols);
		for (const [symbol, reason] of deprecated) {
			warnings.push(
				`${filePath}: Deprecated import "${symbol}" from "${imp.specifier}" → ${reason}`,
			);
		}
	}

	return warnings;
}

const allWarnings: string[] = [];
for (const f of files) {
	const w = await checkFile(f);
	allWarnings.push(...w);
}

if (allWarnings.length > 0) {
	console.log(allWarnings.join("\n"));
	process.exit(1);
}
