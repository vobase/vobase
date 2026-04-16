#!/usr/bin/env bun
/**
 * Downloads DiceUI component and utility documentation from GitHub.
 * Run with: bun run .claude/skills/diceui/scripts/download-references.ts
 *
 * Fetches MDX docs from:
 * - https://github.com/sadmann7/diceui/tree/main/docs/content/docs/components/radix
 * - https://github.com/sadmann7/diceui/tree/main/docs/content/docs/utilities
 *
 * Outputs markdown reference files to .claude/skills/diceui/references/
 */

import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";

const GITHUB_API = "https://api.github.com";
const REPO = "sadmann7/diceui";
const BRANCH = "main";
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;

const SOURCES = [
  {
    path: "docs/content/docs/components/radix",
    prefix: "components",
  },
  {
    path: "docs/content/docs/utilities",
    prefix: "utilities",
  },
] as const;

const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname);
const REFERENCES_DIR = join(SCRIPT_DIR, "..", "references");

// GitHub token from env (optional, but helps with rate limits)
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

async function fetchJSON(url: string): Promise<any> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "diceui-skill-downloader",
  };
  if (GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${url}\n${await res.text()}`);
  }
  return res.json();
}

async function fetchRaw(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }
  return res.text();
}

/**
 * Strip MDX-specific syntax and convert to clean markdown reference.
 * Removes custom components like <ComponentTabs>, <AutoTypeTable>, etc.
 * and preserves the useful text content.
 */
function mdxToMarkdown(mdx: string, name: string): string {
  // Extract frontmatter
  const frontmatterMatch = mdx.match(/^---\n([\s\S]*?)\n---/);
  let title = name;
  let description = "";

  if (frontmatterMatch) {
    const fm = frontmatterMatch[1];
    const titleMatch = fm.match(/title:\s*(.+)/);
    const descMatch = fm.match(/description:\s*(.+)/);
    if (titleMatch) title = titleMatch[1].trim();
    if (descMatch) description = descMatch[1].trim();
  }

  // Remove frontmatter
  let content = mdx.replace(/^---\n[\s\S]*?\n---\n*/, "");

  // Remove import statements
  content = content.replace(/^import\s+.*$/gm, "");

  // Remove self-closing custom MDX components
  content = content.replace(/<ComponentTabs[^>]*\/>/g, "");
  content = content.replace(/<ComponentSource[^>]*\/>/g, "");
  content = content.replace(/<Preview[^>]*\/>/g, "");

  // Convert AutoTypeTable to a note about props
  content = content.replace(
    /<AutoTypeTable\s+path="([^"]*?)"\s+name="([^"]*?)"\s*\/>/g,
    (_match, _path, propsName) => `> Props: \`${propsName}\``
  );

  // Replace DataAttributesTable with a pointer to docs
  content = content.replace(
    /<DataAttributesTable\s+data=\{[\s\S]*?\}\s*\/>/g,
    `> Data attributes available — see [docs](https://diceui.com/docs/components/${name})`
  );

  // Replace CSSVariablesTable with a pointer to docs
  content = content.replace(
    /<CSSVariablesTable\s+data=\{[\s\S]*?\}\s*\/>/g,
    `> CSS variables available — see [docs](https://diceui.com/docs/components/${name})`
  );

  // Replace KeyboardShortcutsTable with a pointer to docs
  content = content.replace(
    /<KeyboardShortcutsTable\s+data=\{[\s\S]*?\}\s*\/>/g,
    `> Keyboard shortcuts available — see [docs](https://diceui.com/docs/components/${name})`
  );

  // Remove Steps/Step components but keep content
  content = content.replace(/<\/?Steps>/g, "");
  content = content.replace(/<\/?Step>/g, "");

  // Remove any remaining custom JSX/MDX tags (non-standard HTML)
  content = content.replace(/<\/?(?:Callout|Note|Tip|Warning|Info)[^>]*>/g, "");

  // Clean up excessive blank lines
  content = content.replace(/\n{4,}/g, "\n\n\n");
  content = content.trim();

  // Build final markdown
  let md = `# ${title}\n\n`;
  if (description) {
    md += `${description}\n\n`;
  }
  md += content;

  return md;
}

async function downloadSource(source: (typeof SOURCES)[number]) {
  console.log(`\nFetching file list from ${source.path}...`);

  const contents = await fetchJSON(
    `${GITHUB_API}/repos/${REPO}/contents/${source.path}?ref=${BRANCH}`
  );

  const mdxFiles = (contents as any[]).filter(
    (f: any) => f.type === "file" && f.name.endsWith(".mdx")
  );

  console.log(`Found ${mdxFiles.length} ${source.prefix} docs`);

  // Download all MDX files in parallel
  const results = await Promise.allSettled(
    mdxFiles.map(async (file: any) => {
      const name = file.name.replace(/\.mdx$/, "");
      const rawUrl = `${RAW_BASE}/${source.path}/${file.name}`;

      console.log(`  Downloading ${source.prefix}/${name}...`);
      const mdx = await fetchRaw(rawUrl);
      const markdown = mdxToMarkdown(mdx, name);

      const outPath = join(REFERENCES_DIR, source.prefix, `${name}.md`);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, markdown, "utf-8");

      return { name, size: markdown.length };
    })
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected");

  console.log(`  ${succeeded}/${mdxFiles.length} downloaded successfully`);
  if (failed.length > 0) {
    for (const f of failed) {
      console.error(`  FAILED: ${(f as PromiseRejectedResult).reason}`);
    }
  }
}

async function main() {
  console.log("DiceUI Reference Downloader");
  console.log("===========================");
  console.log(`Repository: ${REPO}`);
  console.log(`Branch: ${BRANCH}`);
  console.log(`Output: ${REFERENCES_DIR}`);

  mkdirSync(REFERENCES_DIR, { recursive: true });

  for (const source of SOURCES) {
    await downloadSource(source);
  }

  console.log("\nDone! References updated.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
