---
name: sg-chart-of-accounts
description: >-
  FRS-aligned Singapore chart of accounts patterns for Vobase ERP modules. Use
  when designing account masters, numbering rules, GST control accounts, and
  validation checks for auditable SME financial reporting.
category: vertical
domain: [accounting, singapore, financial-reporting]
enhances: [integer-money]
version: 1.0.0
last_verified: "2026-03-01"
tier: core
---

# Singapore Chart of Accounts (SG)

**Disclaimer:** Account structure guidance is current as of 2026-03-01. Verify with your auditor or SFRS documentation before production use.

## Why This Matters

- Wrong chart structure can produce misclassified balances, delayed close, and failed audit walkthroughs.
- Singapore-incorporated companies are expected to prepare and file financial statements (subject to exemptions), so account classes must map cleanly to statement presentation ([ACRA filing requirements](https://www.acra.gov.sg/xbrl-filing-and-resources/who-needs-to-file-financial-statements)).
- SFRS for Small Entities sets the reporting framework for eligible SMEs; your ledger structure should support that reporting logic ([ACRA SFRS for Small Entities](https://www.acra.gov.sg/accountancy/accounting-standards/pronouncements/singapore-financial-reporting-standard-for-small-entities)).
- Missing GST control accounts (input and output) causes GST return and GL reconciliation failures.

## Schema Patterns

Use an explicit account master with typed ranges and parent-child numbering.

```typescript
import { sqliteTable, text, integer, foreignKey } from 'drizzle-orm/sqlite-core';

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    number: text('number').notNull().unique(),
    name: text('name').notNull(),
    type: text('type', { enum: ['asset', 'liability', 'equity', 'revenue', 'expense'] }).notNull(),
    parent_number: text('parent_number'),
    is_system: integer('is_system', { mode: 'boolean' }).notNull().default(false),
    is_active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    created_at: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
  },
  (table) => [
    foreignKey({
      columns: [table.parent_number],
      foreignColumns: [table.number],
      name: 'accounts_parent_number_fk',
    }),
  ],
);

export const requiredSystemAccounts = [
  { number: '1030', name: 'GST Receivable (Input Tax)', type: 'asset' as const, is_system: true },
  { number: '2020', name: 'GST Payable (Output Tax)', type: 'liability' as const, is_system: true },
  { number: '3010', name: 'Retained Earnings', type: 'equity' as const, is_system: true },
  { number: '3020', name: 'Current Year Profit/Loss', type: 'equity' as const, is_system: true },
];
```

## Business Rules

This skill uses a concrete Singapore SME numbering convention for consistent reporting. SFRS does not prescribe exact account codes; this range map is the implementation convention:

```text
1xxx = Assets
  10xx-14xx = Current assets
  15xx-19xx = Non-current assets
2xxx = Liabilities
  20xx-24xx = Current liabilities
  25xx-29xx = Non-current liabilities
3xxx = Equity
4xxx = Revenue
5xxx = Expenses
```

- Required system accounts must exist and remain active: `1030` GST Receivable, `2020` GST Payable, `3010` Retained Earnings, `3020` Current Year Profit/Loss.
- GST input/output tax accounts are mandatory even for simple SMEs, because GST settlement depends on separate asset and liability control balances.
- `parent_number` defines hierarchy for roll-ups (for example `1000` Assets -> `1100` Cash and Bank -> `1110` Operating Bank).
- Do not post directly to heading/group accounts; post to leaf accounts only.
- Keep all monetary postings in integer cents (see `integer-money`) and keep account master values non-monetary.

## Validation Patterns

- Account number uniqueness constraint

```text
Given account number 2010 already exists
When a new account is created with number 2010
Then creation must fail with a unique-constraint error
```

- Number range must match account type

```text
Given an account number starts with 1 (for example 1510)
When account type is set to liability
Then validation must reject it because 1xxx requires type=asset
```

- Required system accounts present and active

```text
Given a chart migration is complete
When the verifier checks system accounts
Then 1030, 2020, 3010, and 3020 must exist with is_system=true and is_active=true
```

- No circular parent references

```text
Given 1100 -> 1110 and an update attempts 1100.parent_number = 1110
When hierarchy validation runs
Then the update must fail because the graph would contain a cycle
```

## Common Mistakes

- Building a flat account list with no `parent_number` hierarchy.
- Omitting GST receivable/payable control accounts and trying to net GST in one account.
- Mixing chart conventions across modules (for example 4xxx revenue in one module, 7xxx revenue in another).
- Assigning wrong account types for number ranges (for example 2xxx marked as asset).

## References

- [Singapore SME starter chart of accounts template](references/sme-coa-template.md)
- [ACRA: who needs to file financial statements](https://www.acra.gov.sg/xbrl-filing-and-resources/who-needs-to-file-financial-statements)
- [ACRA: SFRS for Small Entities](https://www.acra.gov.sg/accountancy/accounting-standards/pronouncements/singapore-financial-reporting-standard-for-small-entities)

## Known Simplifications

- This skill does not cover consolidated group accounts.
- This skill does not cover XBRL filing taxonomy mapping.
- This skill does not cover multi-currency functional currency adjustments.
- This skill does not cover FRS 109 financial instrument classifications.
