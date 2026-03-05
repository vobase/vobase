# Vobase ERP Skill Format

Specification for ERP agent skills in the Vobase project. Skills teach AI agents domain knowledge, business rules, and implementation patterns beyond generic code generation.

## Frontmatter Fields

All fields except `name` and `description` are optional for backward compatibility.

- **`name`** (required): Unique identifier in lowercase-kebab-case.
- **`description`** (required): Dense operational description with trigger phrases for the agent.
- **`category`**: `core` (system-wide), `vertical` (industry-specific), or `migration` (data extraction).
- **`domain`**: Array of tags like `[accounting, logistics, compliance]`.
- **`enhances`**: Array of other skill names this skill complements.
- **`version`**: Semantic version of the skill content.
- **`last_verified`**: ISO date of last domain rate/rule verification.
- **`tier`**: `core` (Vobase official), `community`, or `validated` (third-party certified).

## Body Sections

ERP skills should use these six sections to provide comprehensive domain guidance.

1. **Why This Matters**: Business context and risks. Explain what happens if this logic is ignored (e.g., "IEEE 754 rounding errors in financial reports").
2. **Schema Patterns**: Drizzle table definitions using Vobase conventions (integer cents, UTC timestamps, status enums).
3. **Business Rules**: The core logic. Calculations, thresholds, and state transition requirements.
4. **Validation Patterns**: The moat. Test cases and edge cases discovered from real-world deployments.
5. **Common Mistakes**: Anti-patterns specific to this domain that agents frequently generate.
6. **References**: Links to detailed files in the `references/` subdirectory.

## Hub-and-Spoke Pattern

Keep `SKILL.md` under 200 lines. Move deep technical details to the `references/` directory.

- `schema.md`: Complete table and constraint definitions.
- `calculations.md`: Mathematical proofs and rounding logic.
- `edge-cases.md`: Rare but critical failure modes.
- `compliance.md`: Statutory requirements and audit rules.

Links are one-way: `SKILL.md` points to references. References should be self-contained and ≤200 lines each.

## Enhances Semantics

- **Advisory Only**: `enhances` is a hint, not a hard dependency.
- **Additive**: Skills listed should be loaded if available to provide complementary context.
- **Flat**: No transitive resolution. If Skill A enhances B, and B enhances C, loading A only loads A and B.

## Template Skeleton

```markdown
---
name: your-skill-id
description: >-
  Trigger phrase for the agent. Use when building X or implementing Y.
category: vertical
domain: [accounting]
enhances: [another-skill]
version: 1.0.0
last_verified: 2024-03-01
tier: core
---

# Skill Title

Short overview of the business domain.

## Why This Matters
Financial impact of incorrect implementation.

## Schema Patterns
[code block with Drizzle tables]

## Business Rules
[step-by-step logic]

## Validation Patterns
- Edge case: [description]
- Test: [expected outcome]

## Common Mistakes
- Bad: [example code]
- Good: [correction]

## References
- [Reference Title](references/file.md)
```
