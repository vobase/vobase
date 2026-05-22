#!/usr/bin/env bun
/**
 * Voltade onboarding-guide renderer.
 *
 * Usage:
 *   bun render.ts path/to/guide.md
 *
 * Inputs:
 *   - A markdown file with YAML frontmatter:
 *       ---
 *       title: "BuildCo *HR AI*"        # one *word* becomes the italic accent
 *       title_color: mauve              # mauve | purple (default purple)
 *       eyebrow: "DEMO · BUILDCO GROUP"
 *       contact: "yash@voltade.com"
 *       lede: "A Voltade demo for BuildCo Group — ..."
 *       quick_access:
 *         - "Web: [demo-hr.voltade.app](https://demo-hr.voltade.app)"
 *         - "WhatsApp: +65 8000 0001 ([wa.me/6580000001](https://wa.me/6580000001))"
 *       ---
 *
 *       SECTION HEADING                    ← all-caps line at start of a paragraph
 *       Body paragraph(s)...
 *
 *       1. Numbered steps for procedures
 *       - Bullet items
 *
 *       Suggested prompts use a `> ` quote block — each line becomes a prompt list item.
 *
 *       Pull-out cards use a fenced cards block:
 *       :::cards
 *       ### ADAPTIVE SOFTWARE
 *       Body.
 *       ### SELF-LEARNING
 *       Body.
 *       :::
 *
 * Output:
 *   - guide.html (intermediate, kept for debugging)
 *   - guide.pdf  (final, A4)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, basename, extname, join } from 'node:path';

// ---- Tiny YAML frontmatter parser (no deps) ----
function parseFrontmatter(src: string): { meta: Record<string, unknown>; body: string } {
  if (!src.startsWith('---')) return { meta: {}, body: src };
  const end = src.indexOf('\n---', 3);
  if (end === -1) return { meta: {}, body: src };
  const head = src.slice(3, end).trim();
  const body = src.slice(end + 4).replace(/^\n/, '');
  const meta: Record<string, unknown> = {};
  let listKey: string | null = null;
  for (const rawLine of head.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const stripped = line.trim();
    if (!stripped) continue;
    if (stripped.startsWith('- ')) {
      if (listKey) {
        (meta[listKey] as string[]).push(stripQuotes(stripped.slice(2).trim()));
      }
      continue;
    }
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, rawVal] = m;
    if (rawVal === '') {
      meta[key] = [];
      listKey = key;
    } else {
      meta[key] = stripQuotes(rawVal.trim());
      listKey = null;
    }
  }
  return { meta, body };
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

// ---- Minimal markdown → HTML converter ----
// Handles only the subset the onboarding-guide skill needs.
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderInline(s: string): string {
  // Escape first, then apply markdown — but preserve raw HTML in inline code/links.
  let out = escapeHtml(s);
  // Inline code: `...`
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold: **...**
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic: *...* (single asterisks, non-greedy, not inside code)
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  // Links: [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // Arrow → entity passthrough is fine
  return out;
}

function isMonoCapsHeading(line: string): boolean {
  // Matches lines like "ACCESS", "TRY THE AI ON WHATSAPP", "1. OPEN + SIGN IN"
  const stripped = line.replace(/^\d+\.\s+/, '').trim();
  if (stripped.length < 3) return false;
  if (!/[A-Z]/.test(stripped)) return false;
  // No lowercase letters allowed (apart from a few connectors)
  return /^[A-Z0-9 ()+&\-·.,/·]+$/.test(stripped);
}

function renderBody(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let i = 0;

  function flushList(buf: string[], ordered: boolean, klass = '') {
    if (buf.length === 0) return;
    const tag = ordered ? 'ol' : 'ul';
    const klassAttr = klass ? ` class="${klass}"` : '';
    out.push(`<${tag}${klassAttr}>`);
    for (const item of buf) out.push(`  <li>${renderInline(item)}</li>`);
    out.push(`</${tag}>`);
    buf.length = 0;
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip blank lines (paragraph separators handled inline)
    if (trimmed === '') {
      i++;
      continue;
    }

    // Horizontal rule
    if (trimmed === '---' || trimmed === '***') {
      out.push('<hr class="rule" />');
      i++;
      continue;
    }

    // :::cards fenced block
    if (trimmed === ':::cards') {
      i++;
      const cards: { title: string; body: string }[] = [];
      let curTitle = '';
      let curBody: string[] = [];
      const pushCard = () => {
        if (curTitle) {
          cards.push({ title: curTitle, body: curBody.join(' ').trim() });
          curTitle = '';
          curBody = [];
        }
      };
      while (i < lines.length && lines[i].trim() !== ':::') {
        const l = lines[i].trim();
        if (l.startsWith('### ')) {
          pushCard();
          curTitle = l.slice(4).trim();
        } else if (l) {
          curBody.push(l);
        }
        i++;
      }
      pushCard();
      if (lines[i] && lines[i].trim() === ':::') i++;
      out.push('<div class="cards">');
      for (const c of cards) {
        out.push('  <div class="card">');
        out.push(`    <div class="card-title">${renderInline(c.title)}</div>`);
        out.push(`    <div class="card-body">${renderInline(c.body)}</div>`);
        out.push('  </div>');
      }
      out.push('</div>');
      continue;
    }

    // Suggested-prompts blockquote (consecutive `> ` lines)
    if (trimmed.startsWith('> ')) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        buf.push(lines[i].trim().slice(2).trim());
        i++;
      }
      flushList(buf, false, 'prompts');
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        // Capture multi-line list items: continuation lines start with indent
        let item = lines[i].replace(/^\s*\d+\.\s+/, '');
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) {
          item += ' ' + lines[i].trim();
          i++;
        }
        buf.push(item);
      }
      flushList(buf, true);
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(trimmed)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*[-*]\s+/, '');
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) {
          item += ' ' + lines[i].trim();
          i++;
        }
        buf.push(item);
      }
      flushList(buf, false);
      continue;
    }

    // Mono-caps section heading
    if (isMonoCapsHeading(line)) {
      out.push(`<h2 class="section">${renderInline(trimmed)}</h2>`);
      i++;
      continue;
    }

    // Serif section heading: `## Sentence case`
    if (trimmed.startsWith('## ')) {
      out.push(`<h2 class="section-serif">${renderInline(trimmed.slice(3))}</h2>`);
      i++;
      continue;
    }

    // Subsection: `### TITLE` outside of :::cards becomes h3
    if (trimmed.startsWith('### ')) {
      out.push(`<h3 class="subsection">${renderInline(trimmed.slice(4))}</h3>`);
      i++;
      continue;
    }

    // Paragraph (collect until blank line or block boundary)
    const paraLines: string[] = [trimmed];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith('> ') &&
      !lines[i].trim().startsWith('### ') &&
      lines[i].trim() !== ':::cards' &&
      lines[i].trim() !== '---' &&
      !isMonoCapsHeading(lines[i])
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    const text = paraLines.join(' ');
    out.push(`<p>${renderInline(text)}</p>`);
  }
  return out.join('\n');
}

// ---- Wrap title text — convert *word* into <em>word</em> ----
function renderTitle(raw: string): string {
  return escapeHtml(raw).replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

// ---- Main ----
async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: bun render.ts <guide.md>');
    process.exit(1);
  }
  const absInput = resolve(inputPath);
  if (!existsSync(absInput)) {
    console.error(`File not found: ${absInput}`);
    process.exit(1);
  }

  const src = readFileSync(absInput, 'utf-8');
  const { meta, body } = parseFrontmatter(src);

  const title = (meta.title as string) || 'Voltade — Demo Onboarding';
  const titleColor = (meta.title_color as string) === 'mauve' ? 'mauve' : '';
  const eyebrow = (meta.eyebrow as string) || 'DEMO ONBOARDING';
  const contact = (meta.contact as string) || 'yash@voltade.com';
  const lede = (meta.lede as string) || '';
  const quickAccess = (meta.quick_access as string[] | undefined) || [];

  const titleHtml = renderTitle(title);
  const ledeHtml = lede ? `<p class="lede">${renderInline(lede)}</p>` : '';
  const quickHtml = quickAccess.length
    ? `<p class="quick-access">${quickAccess.map(renderInline).join(' &middot; ')}</p>`
    : '';
  const bodyHtml = renderBody(body);

  const composed = `
<h1 class="doc-title${titleColor ? ' ' + titleColor : ''}">${titleHtml}</h1>
${ledeHtml}
${quickHtml}
<hr class="rule" />
${bodyHtml}
`;

  // Load template
  const tplPath = join(dirname(import.meta.url.replace('file://', '')), 'render.html');
  let template = readFileSync(tplPath, 'utf-8');
  template = template
    .replace(/\{\{TITLE\}\}/g, escapeHtml(title.replace(/\*/g, '')))
    .replace('{{EYEBROW}}', escapeHtml(eyebrow))
    .replace('{{CONTACT}}', escapeHtml(contact))
    .replace('{{BODY}}', composed);

  const base = basename(absInput, extname(absInput));
  const outDir = dirname(absInput);
  const htmlOut = join(outDir, `${base}.html`);
  const pdfOut = join(outDir, `${base}.pdf`);

  // Copy voltade.css alongside the HTML so the relative <link> resolves
  const cssPath = join(dirname(tplPath), 'voltade.css');
  const cssTarget = join(outDir, 'voltade.css');
  if (resolve(cssPath) !== resolve(cssTarget)) {
    writeFileSync(cssTarget, readFileSync(cssPath, 'utf-8'));
  }
  writeFileSync(htmlOut, template);
  console.log(`✓ wrote ${htmlOut}`);

  // Print to PDF via headless Chromium (Playwright if available, else chrome CLI)
  try {
    // Dynamic import — playwright may not be installed everywhere
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(`file://${htmlOut}`, { waitUntil: 'networkidle' });
    await page.pdf({
      path: pdfOut,
      format: 'A4',
      margin: { top: '18mm', bottom: '22mm', left: '18mm', right: '18mm' },
      printBackground: true,
    });
    await browser.close();
    console.log(`✓ wrote ${pdfOut}`);
  } catch (err) {
    console.warn('Playwright not available — falling back to chrome CLI.');
    const chrome = process.env.CHROME_PATH
      || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(chrome, [
      '--headless=new',
      '--disable-gpu',
      `--print-to-pdf=${pdfOut}`,
      `--no-pdf-header-footer`,
      `file://${htmlOut}`,
    ]);
    if (r.status === 0) {
      console.log(`✓ wrote ${pdfOut} (via chrome CLI)`);
    } else {
      console.error('PDF render failed. Install playwright (bun add -d playwright && bunx playwright install chromium) or set CHROME_PATH.');
      console.error(r.stderr?.toString());
      process.exit(1);
    }
  }
}

main();
