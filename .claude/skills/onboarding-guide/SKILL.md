---
name: onboarding-guide
description: |
  Generate a Voltade-branded 1-page or 2-page demo onboarding guide (Markdown source + print-ready PDF) for a new client demo or sandbox. Use this skill whenever the user says "make an onboarding guide", "write an onboarding doc", "create a 1-pager", "create a 2-pager", "demo handout", "demo onboarding", "client handoff doc", or names a specific client + asks for an onboarding artefact (e.g. "draft the onboarding for the {client} demo"). Also use when the user says "spin up the onboarding PDF", "give me the onboarding doc for {project}", "do the {client} handout", or asks to update an existing onboarding guide. Baked-in: Voltade design system tokens (mauve + purple-9, Source Serif 4 / DM Sans / IBM Plex Mono), the one-italic-accent-word rule, the running-header pattern, the standard sections (ACCESS · TRY THE AI ON WHATSAPP · SUGGESTED PROMPTS · WHAT'S PRE-LOADED · TWO THINGS WORTH NOTICING for 1-pagers; ACCESS · TRY THE AI · "What the system does" cluster for 2-pagers), and a markdown→HTML→PDF pipeline via headless Chromium.
---

# Onboarding-guide generator — Voltade demo handouts

Every Voltade demo ships with a one or two page onboarding PDF that explains: how to sign in, how to add yourself as a tester, what to type at the AI, and what makes the system worth a second look. This skill produces that artefact in the canonical Voltade brand, from a single markdown source.

## When to use

- A new client demo or sandbox has just been provisioned and needs a handout.
- An existing onboarding guide needs to be updated (new phone number, new sections, new client name).
- A salesperson asks for a "demo onboarding doc" or "client handout" — assume this skill.

Skip if the user wants something fundamentally different (a sales deck, a pitch, a contract, a long-form spec). This skill is purpose-built for the 1–2 page demo handout pattern only.

## What you get

A single markdown source file → a styled HTML preview → a print-ready A4 PDF that matches the existing handouts (AcmeTelco demo, BuildCo HR AI, etc.) exactly.

```
my-guide.md   →   my-guide.html   →   my-guide.pdf
```

## The two formats

| | **1-pager** | **2-pager (or 3-page)** |
|---|---|---|
| When | Sandbox-style demo with a sample prompt menu and pre-loaded data | Full client demo with feature breakdown and "what the system does" depth |
| Length | Single dense A4 page | 2–3 A4 pages, more breathing room |
| Section style | Numbered (`1. OPEN + SIGN IN`, `2. ADD YOURSELF...`) | Unnumbered mono-caps (`ACCESS`, `TRY THE AI ON WHATSAPP`) + a serif `## What the system does` block with mono-caps subsections |
| Title color | `purple` (purple-9) | `mauve` (mauve-12) |
| Suggested prompts | Yes — 3 italic blockquote lines | Sometimes — usually inline in the steps |
| Pre-loaded data summary | Inline single para | Skipped — replaced by per-feature breakdown |
| Pull-out cards at end | Yes — "TWO THINGS WORTH NOTICING" | No |
| Feature breakdown | No | Yes — 5–7 mono-caps subsections (SELF-IMPROVING / ADAPTIVE SOFTWARE / ONE INBOX / BUILT-IN {DOMAIN} FEATURES / GUARDRAILS / HUMAN-IN-THE-LOOP / AUTOMATIONS) |
| Eyebrow | `DEMO ONBOARDING` | `DEMO · {CLIENT NAME UPPERCASE}` |
| Example | `examples/telco-demo.md` | `examples/buildco-hr.md` |

Default to the **1-pager** for sandbox demos and quick handouts. Default to the **2-pager** when the user wants to explain what the system does, not just how to log in.

## Workflow

### Step 1 — Gather the inputs

Before writing anything, collect:

- **Client name** — both casual (`BuildCo`) and corporate (`BuildCo Group`).
- **Project name** — the AI's name (`BuildCo HR AI`, `AcmeBot`, `MerchantAssistant`).
- **Domain** — HR / customer-care / sales / clinic / ... — drives the feature vocabulary.
- **Domain channels** — WhatsApp, web, email, in-app — drives the "ONE INBOX FOR..." line.
- **URLs** — the demo URL, the test-web URL (if any), the WhatsApp number + `wa.me` deep link.
- **Allowlisted email domains** — usually 2–3 domains (`@client.com`, `@client.com.sg`, `@voltade.com`).
- **Link token** — the `/link <token>` value for WhatsApp deep-link enrolment (from the channels module).
- **3 suggested prompts** (1-pager only) — concrete, domain-specific, include one wrinkle (a price, a date, an exception, or an escalation-worthy edge case).
- **Pre-loaded data summary** (1-pager only) — what's seeded: N conversations, knowledge base files, staff teammates.
- **Feature breakdown** (2-pager only) — 3–5 domain-specific features with one-line descriptions. Mirror the structure: **Feature name** — verb-led description with concrete capability.

If any of these are unknown, ASK before writing. Don't invent client URLs or phone numbers.

### Step 2 — Copy the right template and fill it in

```bash
# For a sandbox-style 1-pager:
cp .claude/skills/onboarding-guide/templates/onepager.md ./{client}-onboarding.md

# For a full 2-pager:
cp .claude/skills/onboarding-guide/templates/twopager.md ./{client}-onboarding.md
```

Then edit the `{placeholder}` tokens. Read both example files first (`examples/telco-demo.md` and `examples/buildco-hr.md`) to feel the tone before you start writing.

### Step 3 — Render

```bash
bun .claude/skills/onboarding-guide/templates/render.ts {client}-onboarding.md
```

Outputs alongside the source:
- `{client}-onboarding.html` — preview in browser
- `{client}-onboarding.pdf` — print-ready A4
- `voltade.css` — the brand stylesheet (copied next to the HTML so the relative link resolves)

The renderer uses Playwright if installed, otherwise falls back to `chrome --headless --print-to-pdf`. On macOS the chrome fallback hits `/Applications/Google Chrome.app/...` by default; override with `CHROME_PATH=...`.

### Step 4 — Eyeball and iterate

Open the PDF. Check:

- Title fits on one line (shorten the italic accent word if it overflows).
- Mono-caps headings haven't word-wrapped awkwardly mid-section.
- Code chips (`@client.com`, `/link ...`) don't break a line in the middle.
- The lede + quick-access strip stays above the first `---` hairline.
- 1-pager actually fits on one page. If it spills, shorten the WHAT'S PRE-LOADED paragraph or compress the suggested prompts.
- 2-pager's "What the system does" block starts after a hairline, ideally near the top of a fresh visual section (the first page is "how to use", the rest is "what it is").

## Frontmatter schema

```yaml
---
title: "BuildCo *HR AI*"          # required — wrap ONE word in *asterisks* for the italic accent
title_color: mauve                # 'mauve' (default for 2-pager) or 'purple' (default for 1-pager)
eyebrow: "DEMO · BUILDCO GROUP"   # required — top-right caps eyebrow; mono spaced
contact: "yash@voltade.com"       # required — footer email
lede: "**A Voltade demo for ...** — short description ending with a verb-driven adjective."
quick_access:                     # optional — list of inline-formatted strings, joined with ·
  - "**Web:** [demo-hr.voltade.app](https://demo-hr.voltade.app)"
  - "**WhatsApp:** +65 8000 0001 ([wa.me/6580000001](https://wa.me/6580000001))"
---
```

**The italic accent rule.** Exactly ONE word per title gets wrapped in `*...*` — the renderer converts it to a purple-9 italic. Never two. The whole brand-accent moment is this one word.

**Title color.**
- 1-pagers default to `purple` (the entire title in purple-9 — feels punchy, sandbox-y).
- 2-pagers default to `mauve` (mauve-12 title, italic accent in purple-9 — feels editorial).

## Body markdown conventions

The renderer is a tiny dep-free markdown subset tuned for this format. Use these conventions:

| Want | Write |
|---|---|
| Mono-caps section heading | `ACCESS` or `1. OPEN + SIGN IN` on its own line (ALLCAPS-only-after-numeric-prefix) |
| Serif section heading (the "What the system does" level) | `## What the system does` |
| Mono-caps subsection (inside a serif section) | `A SELF-IMPROVING AI ASSISTANT` on its own line |
| Numbered procedure | `1. Step one...` / `2. Step two...` |
| Bulleted feature list | `- **Feature** — description.` |
| Suggested prompts (italic-serif list) | `> "Prompt one."` / `> "Prompt two."` (consecutive `> ` lines become a `.prompts` list) |
| Pull-out cards (1-pager finale) | `:::cards` / `### CARD TITLE` / `Body...` / repeat / `:::` |
| Hairline rule | `---` on its own line |
| Inline code (emails, commands, paths) | Backticks: `` `@client.com` `` |
| Bold | `**text**` |
| Italic | `*text*` (one word only — reserved for accent words and quoted prompts) |
| Link | `[text](url)` — renders purple-11 underlined |

**The mono-caps heading detector** treats any all-caps line (optionally prefixed by a number) as a section heading. So `ACCESS`, `TRY THE AI ON WHATSAPP`, `1. OPEN + SIGN IN`, and `5. TWO THINGS WORTH NOTICING` all become `<h2 class="section">` automatically. Don't add `##` to those — `##` is reserved for the **serif** heading level.

## Voice and tone

Read both examples before writing. The voice is:

- **Plain and direct.** Second person where natural ("Open the dashboard", "You're now a tester"). No marketing language. No "leverage", "synergy", "powerful".
- **Concrete.** Specific URLs, specific tokens, specific phone numbers. Real example prompts in italic-quoted serif. Real customer questions, not generic ones.
- **Editorial, not sales-y.** One bold accent moment per heading (the italic word or a single `**bold**`). Em-dashes for parenthetical asides. No exclamation marks.
- **Conversational lede.** "A Voltade demo for {Client} — an HR helpdesk that hires, onboards, answers staff, and gets smarter every day." Verb-led, ends with the surprising bit.
- **Code chips for grounded references.** Wrap every email address, domain, file path, and `/link` command in backticks. The renderer puts them in subtle boxed `kbd` style — they read as concrete, not handwavy.
- **Italic prompts.** Suggested customer questions are always italic-serif blockquotes — they should feel like overheard speech.

What NOT to do:

- ❌ Don't use `#` H1 headings inside the body — the `<h1 class="doc-title">` is generated from the frontmatter `title`.
- ❌ Don't add a gradient, drop shadow, or coloured background to any block. Voltade brand = solid mauve + one purple accent, hairlines only.
- ❌ Don't use more than one italic word per heading or per paragraph cluster. The accent rule is strict.
- ❌ Don't add Voltade logos to the body — the running header already embeds the canonical Voltade wordmark (full `Logo+typo.svg` — gradient bolt + "Voltade" typography), and the doc footer has a smaller copy. Every PDF this skill renders carries the brand by default; you never opt in.
- ❌ Don't use ALL CAPS for emphasis inside body prose — that's reserved for mono section headings only.

## Brand rules (baked into voltade.css)

| Token | Value | Use |
|---|---|---|
| Page bg | `#FDFCFD` (mauve-1) | The page colour |
| Body text | `#211F26` (mauve-12) | Primary text |
| Muted text | `#65636D` (mauve-11) | Captions, eyebrow, footer |
| Brand accent | `#6E5DD9` (purple-9) | One-italic-word, lightning bolt, head rule |
| Link colour | `#4B3CB0` (purple-11) | Underlined links |
| Hairline | `#D0CDD7` (mauve-7) | 1px dividers between blocks |
| Display serif | Source Serif 4 | Doc title, serif section heading |
| Body sans | DM Sans | Body copy, list items, lede |
| Mono | IBM Plex Mono | Section headings, eyebrow, footer |
| Spacing | 4 / 8 / 16 / 24 / 32 / 48 / 64 px | 8px base scale |
| Page | A4, 18mm × 22mm margins | Print target |

The brand stylesheet is `templates/voltade.css`. The canonical source of truth for tokens lives at `/Users/yash/Documents/Voltade/voltade-latest-design-system` — if you ever notice the design system has evolved (new colour step, new font), re-sync `voltade.css` from there.

The print stylesheet uses Google Fonts CDN for Source Serif 4 + DM Sans + IBM Plex Mono. The canonical design system also names *Departure Mono* for the "display signpost" role — but Departure isn't on Google Fonts and the print fallback uses IBM Plex Mono with wider tracking. If the artefact ever needs Departure specifically (e.g. for a printed editorial piece), self-host it via `@font-face` in a fork of the CSS.

## Examples (study these first)

- [`examples/telco-demo.md`](./examples/telco-demo.md) — the canonical **1-pager** (AcmeTelco × Voltade Demo Sandbox). Numbered sections, pull-out cards at the end.
- [`examples/buildco-hr.md`](./examples/buildco-hr.md) — the canonical **2-pager** (BuildCo HR AI). Unnumbered mono-caps, serif "What the system does" block, feature bullets.

Both render to PDFs that match the production handouts. Always read at least one before drafting a new guide.

## Common mistakes

| Symptom | Fix |
|---|---|
| `quick_access` items don't render | Make sure each item is YAML-indented under the key, on its own `  - "..."` line |
| Title doesn't get italic accent | Wrap the accent word in `*...*` (single asterisks, not `**bold**`) |
| A section heading rendered as a paragraph | Mono-caps heading detector requires ALL letters to be uppercase. Lowercase like "Or scan the QR code" → use `**bold**` instead, or move the prefix into a bullet/step |
| 1-pager overflows to a second page | Trim the WHAT'S PRE-LOADED paragraph, drop one of the suggested prompts, or shorten the pull-out card bodies (target ≤60 words each) |
| 2-pager italic title overflows | Pick a shorter italic accent word (the BuildCo example uses just "HR AI" — two short words) |
| Code chips break across lines | They're set to `white-space: nowrap` — if you see a break, you're probably using a non-monospace character (en-dash inside backticks). Use a plain hyphen |
| Playwright not installed | The renderer falls back to `chrome --headless --print-to-pdf` automatically. If chrome is at a non-standard path, set `CHROME_PATH=/path/to/chrome` |
| Departure Mono signposts don't render | Expected — Departure isn't on Google Fonts. IBM Plex Mono fallback is intentional |

## File layout

```
.claude/skills/onboarding-guide/
├── SKILL.md                       # This file
├── templates/
│   ├── onepager.md                # 1-pager skeleton with {placeholder} tokens
│   ├── twopager.md                # 2-pager skeleton with {placeholder} tokens
│   ├── voltade.css                # Brand stylesheet (Mauve + Purple + typography + print rules)
│   ├── render.html                # HTML wrapper (Voltade logo + header chrome + {{BODY}} slot + footer)
│   └── render.ts                  # bun script: markdown → HTML → PDF
└── examples/
    ├── telco-demo.md              # Canonical 1-pager source (generic stand-in)
    ├── telco-demo.pdf             # Rendered output (committed for reference)
    ├── lian-beng-hr.md            # Canonical 2-pager source
    └── lian-beng-hr.pdf           # Rendered output (committed for reference)
```

## Quick reference card

```bash
# 1-pager from scratch
cp .claude/skills/onboarding-guide/templates/onepager.md  ./acme-onboarding.md
# 2-pager from scratch
cp .claude/skills/onboarding-guide/templates/twopager.md  ./acme-onboarding.md

# Edit the frontmatter + body, then render
bun .claude/skills/onboarding-guide/templates/render.ts ./acme-onboarding.md
# → ./acme-onboarding.html + ./acme-onboarding.pdf

# If chrome isn't auto-found
CHROME_PATH=/Applications/Chromium.app/Contents/MacOS/Chromium \
  bun .claude/skills/onboarding-guide/templates/render.ts ./acme-onboarding.md
```
