#!/usr/bin/env bun
/**
 * Downloads bunqueue documentation from GitHub.
 * Run with: bun run .agents/skills/bunqueue/scripts/download-references.ts
 *
 * Fetches markdown docs from:
 * - https://github.com/egeominotti/bunqueue/tree/main/docs/src/content/docs/guide
 *
 * Outputs markdown reference files to .agents/skills/bunqueue/references/
 */

import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";

const GITHUB_API = "https://api.github.com";
const REPO = "egeominotti/bunqueue";
const BRANCH = "main";
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;

// Only download docs relevant to Vobase (embedded mode, core APIs)
const RELEVANT_DOCS = [
  "introduction.md",
  "installation.md",
  "quickstart.md",
  "queue.md",
  "worker.md",
  "cron.md",
  "flow.md",
  "stall-detection.md",
  "dlq.md",
  "hono.md",
  "queue-group.md",
  "rate-limiting.md",
  "cpu-intensive-workers.md",
];

const SOURCE_PATH = "docs/src/content/docs/guide";

const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname);
const REFERENCES_DIR = join(SCRIPT_DIR, "..", "references");

// GitHub token from env (optional, but helps with rate limits)
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

async function fetchRaw(url: string): Promise<string> {
  const headers: Record<string, string> = {
    "User-Agent": "bunqueue-skill-downloader",
  };
  if (GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }
  return res.text();
}

/**
 * Clean up VitePress/Starlight-specific syntax from markdown docs.
 * Converts :::tip, :::note, :::caution, :::danger blocks to blockquotes.
 */
function cleanMarkdown(content: string): string {
  // Remove frontmatter
  content = content.replace(/^---\n[\s\S]*?\n---\n*/, "");

  // Convert ::: admonitions to blockquotes
  // Match :::type[optional title] ... :::
  content = content.replace(
    /^:::(tip|note|caution|danger|warning)(?:\[([^\]]*)\])?\n([\s\S]*?)^:::/gm,
    (_match, type, title, body) => {
      const prefix = title
        ? `> **${title}**\n`
        : `> **${type.charAt(0).toUpperCase() + type.slice(1)}**\n`;
      const quotedBody = body
        .trim()
        .split("\n")
        .map((line: string) => `> ${line}`)
        .join("\n");
      return `${prefix}${quotedBody}`;
    }
  );

  // Clean up excessive blank lines
  content = content.replace(/\n{4,}/g, "\n\n\n");
  return content.trim();
}

async function main() {
  console.log("bunqueue Reference Downloader");
  console.log("=============================");
  console.log(`Repository: ${REPO}`);
  console.log(`Branch: ${BRANCH}`);
  console.log(`Output: ${REFERENCES_DIR}`);

  mkdirSync(REFERENCES_DIR, { recursive: true });

  console.log(`\nDownloading ${RELEVANT_DOCS.length} reference docs...`);

  const results = await Promise.allSettled(
    RELEVANT_DOCS.map(async (filename) => {
      const rawUrl = `${RAW_BASE}/${SOURCE_PATH}/${filename}`;
      console.log(`  Downloading ${filename}...`);

      const raw = await fetchRaw(rawUrl);
      const cleaned = cleanMarkdown(raw);

      const outPath = join(REFERENCES_DIR, filename);
      writeFileSync(outPath, cleaned, "utf-8");

      return { name: filename, size: cleaned.length };
    })
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected");

  console.log(`\n${succeeded}/${RELEVANT_DOCS.length} downloaded successfully`);
  if (failed.length > 0) {
    for (const f of failed) {
      console.error(`  FAILED: ${(f as PromiseRejectedResult).reason}`);
    }
  }

  console.log("\nDone! References updated.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
