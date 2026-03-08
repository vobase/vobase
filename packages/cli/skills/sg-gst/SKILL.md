---
name: sg-gst
description: >-
  Singapore GST implementation patterns for Vobase modules. Use when modeling
  GST registration, tax codes, reverse charge, and IRAS F5 filing logic with
  integer-cent accounting and auditable return periods.
category: vertical
domain: [accounting, tax, singapore, compliance]
enhances: [integer-money]
version: 1.0.0
last_verified: "2026-03-01"
tier: core
---

# Singapore GST (SG)

**Disclaimer:** Rates and thresholds are current as of 2026-03-01. Verify with IRAS before production use. This skill provides structural guidance, not tax advice.

## Why This Matters

- Late GST filing can trigger S$200 penalties on outstanding returns; for a quarterly F5 cycle this commonly appears as the late-filing charge on that quarter's return and can escalate monthly if unresolved ([IRAS F5 help](https://mytax.iras.gov.sg/ESVWeb/default.aspx?target=GSTF5OnlineHelp), [IRAS late filing page](https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/filing-gst/late-filing-or-non-filing-of-GST-returns-f5-f8)).
- Underpaid or unpaid GST attracts a 5% late payment penalty, with additional monthly penalties if payment remains overdue ([IRAS F5 help](https://mytax.iras.gov.sg/ESVWeb/default.aspx?target=GSTF5OnlineHelp), [IRAS late payment page](https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/gst-payments-refunds/late-payment-or-non-payment-of-gst)).
- Reverse charge on imported services is easy to miss in naive invoice-only implementations and can cause under-reporting in Box 6 and Box 7 when business users buy overseas SaaS.
- GST return data must reconcile to auditable transaction records; ad-hoc spreadsheets break quickly once you add mixed supplies, credit notes, and import scenarios.

## Schema Patterns

Use integer cents for all monetary values and keep GST metadata explicit per transaction line.

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const gstRegistrations = sqliteTable('gst_registrations', {
  id: text('id').primaryKey(),
  entity_id: text('entity_id').notNull(),
  gst_number: text('gst_number').notNull().unique(),
  registration_basis: text('registration_basis').notNull(), // compulsory | voluntary
  effective_from: integer('effective_from', { mode: 'timestamp' }).notNull(),
  effective_to: integer('effective_to', { mode: 'timestamp' }),
  filing_frequency: text('filing_frequency').notNull().default('quarterly'), // quarterly | monthly
  created_at: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
});

export const gstTaxCodes = sqliteTable('gst_tax_codes', {
  code: text('code').primaryKey(), // SR | ZR | ES | OS
  description: text('description').notNull(),
  default_rate_bps: integer('default_rate_bps').notNull(), // 900 for 9%, 0 for non-standard
  iras_reference_url: text('iras_reference_url').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

export const gstReturnPeriods = sqliteTable('gst_return_periods', {
  id: text('id').primaryKey(),
  entity_id: text('entity_id').notNull(),
  period_start: integer('period_start', { mode: 'timestamp' }).notNull(),
  period_end: integer('period_end', { mode: 'timestamp' }).notNull(),
  due_date: integer('due_date', { mode: 'timestamp' }).notNull(),
  form_type: text('form_type').notNull().default('F5'),
  status: text('status').notNull().default('open'), // open | filed | amended
  box6_output_tax_cents: integer('box6_output_tax_cents').notNull().default(0),
  box7_input_tax_cents: integer('box7_input_tax_cents').notNull().default(0),
  box8_net_gst_cents: integer('box8_net_gst_cents').notNull().default(0),
});

export const transactionTax = sqliteTable('transaction_tax', {
  id: text('id').primaryKey(),
  source_type: text('source_type').notNull(), // invoice_line | bill_line | adjustment
  source_id: text('source_id').notNull(),
  taxable_amount_cents: integer('taxable_amount_cents').notNull(),
  gst_amount_cents: integer('gst_amount_cents').notNull(),
  gst_rate_bps: integer('gst_rate_bps').notNull(),
  gst_code: text('gst_code').notNull(), // SR | ZR | ES | OS
  reverse_charge: integer('reverse_charge', { mode: 'boolean' }).notNull().default(false),
  return_period_id: text('return_period_id'),
});
```

## Business Rules

```ts
const GST_STANDARD_RATE = 0.09; // 9% from 1 Jan 2024 (IRAS: https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/basics-of-gst/current-gst-rates)
const GST_STANDARD_RATE_BPS = 900; // same source as above
const REGISTRATION_THRESHOLD_SGD = 1_000_000; // S$1M taxable turnover (IRAS: https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/gst-registration-deregistration/do-i-need-to-register-for-gst)
const REGISTRATION_THRESHOLD_CENTS = 100_000_000; // S$1,000,000 x 100
const REVERSE_CHARGE_IMPORTED_SERVICES_THRESHOLD_SGD = 1_000_000; // annual imported services value test (IRAS RC e-Tax guide)
```

- Charge standard-rated GST at 9% for standard-rated local supplies ([IRAS current GST rates](https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/basics-of-gst/current-gst-rates)).
- Trigger registration workflow when taxable turnover exceeds or is expected to exceed S$1M in the prescribed 12-month tests ([IRAS registration test](https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/gst-registration-deregistration/do-i-need-to-register-for-gst)).
- Track output tax (sales) and input tax (purchases) separately; compute net GST as `box6_output_tax_cents - box7_input_tax_cents`.
- Treat imported digital/B2B services (for example, cloud SaaS) as reverse-charge candidates when the RC conditions are met, including the >S$1M imported services threshold test in the IRAS RC framework.
- Apply reverse charge logic for eligible GST-registered businesses importing services (including cloud/SaaS) where RC conditions are met; post both output and claimable input entries with full audit trail ([IRAS local businesses page](https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/gst-and-digital-economy/local-businesses), [IRAS Reverse Charge e-Tax Guide](https://www.iras.gov.sg/media/docs/default-source/e-tax/gst-taxing-imported-services-by-way-of-reverse-charge-(2nd-edition).pdf)).
- Model F5 as periodic return records, defaulting to quarterly periods with configurable frequency override for IRAS-assigned special periods.

## Validation Patterns

Use `given / when / then` tests for high-risk GST logic.

- Mixed supply apportionment (forum-sourced): [AccountingWEB thread on VAT recovery apportionment disputes](https://www.accountingweb.co.uk/any-answers/hmrc-query-on-vat-recovery-business-apportionment)

```text
Given a business has both taxable and exempt lines in one period
When shared overhead input tax is posted without apportionment
Then the system must block full claim and require apportionment allocation before F5 lock
```

- Reverse charge on imported SaaS (forum-sourced): [QuickBooks community thread on GST reverse charge handling](https://quickbooks.intuit.com/learn-support/global/tax/how-to-handle-gst-reverse-charge-on-sales-item-revenue-is-car/00/445319)

```text
Given a GST-registered company buys overseas cloud software under RC conditions
When the bill is posted to a reverse-charge tax code
Then the system must auto-generate paired output/input GST entries and include them in the same F5 period
```

- GST-inclusive vs GST-exclusive rounding discrepancy (forum-sourced): [QuickBooks SG thread showing 1-cent mismatch](https://quickbooks.intuit.com/learn-support/en-sg/gst/i-have-a-telco-invoice-as-such-subtotal-115-13gst-9-47quickbooks/01/1534549)

```text
Given supplier invoices use GST-inclusive totals and app line math is GST-exclusive
When computed GST differs by 1 cent from supplier tax line
Then enforce deterministic rounding policy, log variance reason, and preserve supplier-declared tax amount for audit note
```

- Nil return for dormant/inactive period: [IRAS requirement to file nil GST return](https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/filing-gst/late-filing-or-non-filing-of-GST-returns-f5-f8)

```text
Given a GST-registered entity has no taxable activity in a period
When filing deadline approaches
Then generate a nil F5 workflow and prevent silent skip of the period
```

## Common Mistakes

- Applying standard-rated GST to exempt supplies (for example, qualifying financial services or residential property transactions).
- Forgetting reverse charge treatment for imported SaaS and other overseas B2B services.
- Calculating GST on gross totals without consistent net/tax split and reproducible rounding rules.
- Failing to apportion input tax for mixed taxable/exempt use.
- Treating F5 filing as optional when there is no activity instead of submitting nil returns.

## References

- [Rates and thresholds (current values, history, source links)](references/rates-and-thresholds.md)
- [F5 filing rules (boxes, periods, deadlines, penalties)](references/filing-rules.md)

## Known Simplifications

- This skill does not model Tourist Refund Scheme (TRS) retailer workflows.
- This skill does not model Major Exporter Scheme (MES), IGDS, or other advanced import deferral/suspension schemes.
- This skill does not implement cash accounting scheme variants.
- This skill does not cover every industry-specific concession or zero-rating exception.
- This skill does not provide legal or tax advice and is not a substitute for IRAS rulings.
