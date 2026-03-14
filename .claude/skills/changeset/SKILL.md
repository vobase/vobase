---
name: changeset
description: >
  Generate comprehensive changeset release logs with OG cover images for vobase releases.
  Use this skill when the user says "changeset", "release notes", "release log", "write changelog",
  "version bump", or when a feature implementation is complete and needs to be documented for release.
  Also triggers when the user asks to "write up what changed", "prepare for release", or "create a PR description".
  This skill handles: finding specs/plans, determining version bumps, generating cover images via Stitch MCP,
  and writing the full changeset markdown.
---

# Changeset Release Log Generator

Create comprehensive, well-structured changeset release logs for the vobase monorepo. The changeset follows the `@changesets/cli` format and includes an OG cover image generated via Google Stitch MCP.

## When to Use

- After completing a feature implementation
- When preparing a release
- When the user asks for release notes, changelog, or changeset
- After dogfood testing confirms everything works

## Changesets: How They Work

Changesets use the `@changesets/cli` package for monorepo versioning. Each changeset is a markdown file in `.changeset/` with YAML frontmatter specifying which packages to bump and by how much.

### File Format

```markdown
---
"@vobase/core": minor
"create-vobase": patch
---

Summary of what changed. This text becomes the CHANGELOG.md entry.
You can write as much markdown as you want here.
```

- The YAML frontmatter lists each affected package with its semver bump type
- The markdown body becomes the changelog entry when `changeset version` is run
- Multiple packages can be listed if a single change affects several packages
- You can have multiple changeset files per PR — they stack and get consumed together

### What to Include in the Summary

A good changeset answers three questions:
1. **WHAT** the change is
2. **WHY** the change was made
3. **HOW** a consumer should update their code (if applicable)

### Release Flow

1. Changeset `.md` files accumulate in `.changeset/` during development
2. `bunx changeset version` consumes all changesets, bumps package versions, and updates CHANGELOG.md
3. `bun run build && bunx changeset publish` publishes to npm
4. The consumed changeset files are deleted automatically

### Multiple Changesets per PR

Add more than one changeset when:
- You want different changelog entries for different packages
- You made multiple distinct changes that should each be called out separately

### Vobase Package Names

| Package | npm Name | Purpose |
|---------|----------|---------|
| `packages/core` | `@vobase/core` | Runtime engine |
| `packages/create-vobase` | `create-vobase` | Project scaffolder |
| `packages/template` | `@vobase/template` | Scaffolding source (private, not published) |

Template changes don't need their own changeset entry since it's private — but if template changes depend on core changes, bump core.

## Workflow

### Step 1: Gather Context

Before writing anything, collect evidence of what changed:

1. **Find the spec/plan** — look in these locations (check all):
   - `.omc/specs/*.md` (deep interview specs)
   - `.omc/plans/*.md` (consensus plans)
   - `.omc/prd.json` (PRD with acceptance criteria)
   - Recent git diff: `git diff main --stat` to see changed files

2. **Read the spec** — extract:
   - Goal / what was built
   - Acceptance criteria (what was verified)
   - Architecture decisions and trade-offs
   - Dependencies added/removed
   - Assumptions resolved during planning

3. **Check git history** for bug fixes discovered during implementation:
   ```bash
   git log --oneline --since="1 day ago"
   ```

4. **Check test results** — summarize test coverage:
   ```bash
   bun test 2>&1 | tail -5
   ```

### Step 2: Determine Version Bump

Read the current versions from package.json files:

```bash
cat packages/core/package.json | grep '"version"'
cat packages/template/package.json | grep '"version"'
```

Apply semver rules:
- **major** — breaking API changes, removed exports, schema migrations required
- **minor** — new features, new modules, new capabilities (most common for feature work)
- **patch** — bug fixes, performance improvements, documentation

The changeset format uses package names:
```yaml
---
"@vobase/core": minor
---
```

If multiple packages changed, list each with its own bump level.

### Step 3: Generate OG Cover Image via Stitch

Create a project and generate the cover image. The image must be:
- **Aspect ratio**: 1200x630 (standard OG image)
- **Device type**: DESKTOP
- **Model**: GEMINI_3_PRO (best quality)

**CRITICAL styling rules** (learned from iteration):
- Background `#09090b` must extend **edge-to-edge** — NO outer padding, NO card wrapper, NO border-radius on the root container
- `html, body { margin: 0; padding: 0; background: #09090b; overflow: hidden }`
- Content padding: 40px from edges (internal only)
- Subtle dot grid overlay at 4% white opacity on the background
- Font: clean sans-serif (Inter or similar)

**Layout template**:

LEFT SIDE (55%):
- "VOBASE" — small uppercase label, muted gray `#71717a`, letter-spaced
- Feature name — large bold headline (64px), vibrant blue `#3b82f6`
- Subtitle — white `#fafafa`, 24px, describing the feature
- Feature pills — horizontal badges with colored left borders:
  - Blue `#3b82f6` for primary capabilities
  - Green `#22c55e` for secondary capabilities
  - Amber `#f59e0b` for integrations/providers
- Version tag — monospace, muted `#52525b`, bottom-left (e.g., "v0.12.0")

RIGHT SIDE (45%):
- Visual diagram/pipeline relevant to the feature
- Use colorful icons for entities (red, blue, green, orange, purple, cyan)
- Thin connection lines `#3f3f46` at 1.5px
- Small muted labels on icons/nodes
- The visualization should tell the story of the feature at a glance

**Stitch MCP calls**:
```
1. mcp__stitch__create_project({ title: "Vobase [Feature] Release" })
2. mcp__stitch__generate_screen_from_text({
     projectId: <id>,
     deviceType: "DESKTOP",
     modelId: "GEMINI_3_PRO",
     prompt: <detailed prompt following the template above>
   })
3. Download the screenshot URL from the response
4. Save to .changeset/og-<feature>-<version>.png
```

**Common Stitch pitfalls to avoid**:
- First generation often has too much padding — emphasize "edge-to-edge, NO outer padding" in the prompt
- Specify exact hex colors — don't say "dark" or "muted", give the hex code
- Describe the pipeline/diagram in detail — vague descriptions produce generic results
- Always specify "NO card container, NO border-radius on root, background covers entire viewport"

### Step 4: Write the Changeset

Create `.changeset/<feature-slug>.md` with this structure:

```markdown
---
"@vobase/core": minor
---

# Feature Name: Subtitle

![Feature Name](og-<feature>-<version>.png)

## Primary Feature Section
What was built and why. Lead with the user-facing capability, not the implementation.

### Sub-features
Tables, code examples, architecture details as appropriate.

## Secondary Feature Section
Additional capabilities that shipped alongside the primary feature.

## Frontend Changes
UI changes visible to users.

## Dependencies Added
List new packages with a one-line description of each.

## Bug Fixes
Issues found and fixed during implementation/dogfood testing.

## Test Coverage
Summary of test files and counts.
```

**Writing style**:
- Lead with what the user can DO, not what was implemented
- Use tables for format/library/capability mappings
- Include code snippets for new APIs or configuration options
- Be specific about numbers (test counts, file counts, performance)
- Bug fixes section should explain what was wrong and how it was fixed
- Don't use marketing language — be direct and technical

### Step 5: Verify

Before finishing:
1. Read back the changeset file to confirm formatting
2. Verify the OG image downloaded correctly (check file size > 10KB)
3. Confirm the version bump level matches the scope of changes
4. Check that all major features from the spec are covered in the release notes

## Example Prompt to Stitch

Here's a proven prompt pattern that produces good results (customize the specifics):

```
Design a release announcement OG image for "Vobase". CRITICAL: The ENTIRE
canvas background must be #09090b edge-to-edge with ZERO outer padding,
ZERO card wrapper, ZERO border-radius on root. Background goes from pixel
0,0 to the very last pixel. html/body: margin 0, padding 0, background
#09090b, overflow hidden.

Content padding: 40px from edges internally. Subtle white dot grid at 4%
opacity on background.

LEFT SIDE (55%): "VOBASE" muted gray #71717a uppercase label. "[Feature]"
64px bold blue #3b82f6 headline. "[Subtitle]" 24px white #fafafa. Three
feature pills with colored left borders (blue #3b82f6, green #22c55e,
amber #f59e0b): "[Pill 1]", "[Pill 2]", "[Pill 3]". "v[X.Y.Z]" monospace
#52525b bottom-left.

RIGHT SIDE (45%): [Describe the specific visual/diagram for this feature
with exact colors, sizes, and relationships between elements].

Dense layout, no wasted space. Think Supabase launch week graphics.
```

## Image References

Changeset markdown gets consumed into CHANGELOG.md, GitHub PR descriptions, and release pages. Relative image paths (e.g., `og-image.png`) won't resolve in those contexts. Always use absolute raw GitHub URLs:

```markdown
![Feature Name](https://raw.githubusercontent.com/vobase/vobase/main/.changeset/og-<feature>-<version>.png)
```

The image file still lives in `.changeset/` and gets committed to the repo — the URL points to the raw file on the `main` branch.

## File Locations

- Changesets: `.changeset/<feature-slug>.md`
- OG images: `.changeset/og-<feature>-<version>.png` (referenced via raw GitHub URL)
- Specs (input): `.omc/specs/*.md`
- Plans (input): `.omc/plans/*.md`
- PRD (input): `.omc/prd.json`
