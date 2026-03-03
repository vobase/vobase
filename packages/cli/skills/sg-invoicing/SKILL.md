---
name: sg-invoicing
description: >-
  Singapore invoicing compliance patterns for IRAS tax invoices, credit notes,
  GST-safe totals, and InvoiceNow/Peppol readiness in Vobase ERP modules.
category: vertical
domain: [accounting, invoicing, singapore, compliance, e-invoicing]
enhances: [integer-money, gap-free-sequences, sg-gst]
version: 1.0.0
last_verified: "2026-03-01"
tier: core
---

# Singapore Invoicing (SG)

**Disclaimer:** Invoice requirements are current as of 2026-03-01. Verify with IRAS and IMDA before production use.

## Why This Matters

- Buyers can lose input-tax claims if supplier invoices are missing mandatory tax-invoice fields, so header/line compliance is not optional ([IRAS input tax conditions](https://www.iras.gov.sg/taxes/goods-services-tax-%28gst%29/claiming-gst-%28input-tax%29/conditions-for-claiming-input-tax)).
- GST-registered suppliers must issue tax invoices for standard-rated supplies; credit notes must retain original-invoice traceability for adjustments and reversals ([IRAS invoicing customers](https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/basics-of-gst/invoicing-price-display-and-record-keeping/invoicing-customers)).
- Inconsistent rounding and ad-hoc numbering create audit friction during GST reviews; deterministic math and gap-free business numbers reduce disputes.
- InvoiceNow adoption is being phased under Singapore's GST InvoiceNow requirement, so systems must be ready for both human-readable invoices and structured e-invoices ([IRAS GST InvoiceNow requirement](https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/gst-invoicenow-requirement)).

## Schema Patterns

Use explicit invoice header/line structures with GST metadata and credit-note linkage.

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const invoices = sqliteTable('invoices', {
  id: text('id').primaryKey(),
  number: text('number').notNull().unique(), // Use nextSequence(tx, 'INV')
  invoice_type: text('invoice_type').notNull().default('tax_invoice'), // tax_invoice | simplified_tax_invoice | credit_note
  issue_date: integer('issue_date', { mode: 'timestamp' }).notNull(),
  supplier_name: text('supplier_name').notNull(),
  supplier_address: text('supplier_address').notNull(),
  supplier_uen: text('supplier_uen').notNull(),
  supplier_gst_registration_number: text('supplier_gst_registration_number'),
  customer_name: text('customer_name').notNull(),
  customer_address: text('customer_address').notNull(),
  customer_uen: text('customer_uen'),
  currency: text('currency').notNull().default('SGD'),
  gst_code: text('gst_code').notNull().default('SR'), // SR | ZR | ES | OS | NA
  subtotal_cents: integer('subtotal_cents').notNull(),
  gst_amount_cents: integer('gst_amount_cents').notNull().default(0),
  total_cents: integer('total_cents').notNull(),
  credit_note_for_id: text('credit_note_for_id'), // link to original invoice when invoice_type=credit_note
  peppol_document_type: text('peppol_document_type'), // invoice | credit-note
  peppol_message_id: text('peppol_message_id'),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
});

export const invoiceLines = sqliteTable('invoice_lines', {
  id: text('id').primaryKey(),
  invoice_id: text('invoice_id').notNull(),
  line_no: integer('line_no').notNull(),
  description: text('description').notNull(),
  quantity: integer('quantity').notNull(),
  unit_price_cents: integer('unit_price_cents').notNull(),
  line_total_cents: integer('line_total_cents').notNull(),
  gst_rate_bps: integer('gst_rate_bps').notNull(),
  gst_amount_cents: integer('gst_amount_cents').notNull().default(0),
});
```

Use strict UEN validation for supplier/buyer identifiers when captured.

```ts
const UEN_REGEX = /^[0-9]{8}[A-Z]$|^[A-Z][0-9]{7}[A-Z]$|^T[0-9]{2}[A-Z]{2}[0-9]{4}[A-Z]$/;
```

## Business Rules

- For GST-registered suppliers, tax invoices should contain: invoice identifier, date, supplier details, supplier GST registration number, customer details, description of goods/services, GST rate, value before GST, GST amount, and total payable ([IRAS invoicing customers](https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/basics-of-gst/invoicing-price-display-and-record-keeping/invoicing-customers), [IRAS input tax conditions](https://www.iras.gov.sg/taxes/goods-services-tax-%28gst%29/claiming-gst-%28input-tax%29/conditions-for-claiming-input-tax)).
- For non-GST-registered suppliers, do not represent documents as tax invoices and do not include GST registration fields or GST charges.
- Simplified tax invoices can be used only in IRAS-permitted scenarios (for example, lower-value sales); model them as a distinct `invoice_type` with narrower field requirements ([IRAS invoicing customers](https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/basics-of-gst/invoicing-price-display-and-record-keeping/invoicing-customers)).
- Credit notes must reference the original invoice and clearly indicate adjusted values and GST effect, so GST return adjustments remain auditable.
- Support deterministic GST computation policy (line-based or total-based) and store the policy/version used at posting time so 1-cent variances are explainable during audits.
- InvoiceNow delivery requires sending through an accredited Peppol Access Point and producing structured payloads aligned to PINT SG on UBL 2.1 ([IMDA InvoiceNow](https://imda.gov.sg/how-we-can-help/nationwide-e-invoicing-framework/invoicenow), [PINT SG BIS](https://docs.peppol.eu/poac/sg/2024-Q1/pint-sg/bis/)).

## Validation Patterns

Use `given / when / then` test cases on compliance-critical invoice posting.

```text
Given a GST-registered supplier creates a tax invoice
When supplier GST registration number is empty
Then posting is blocked with a tax-invoice mandatory-field error
```

```text
Given an invoice has line-level GST and header-level GST totals
When sum(line.gst_amount_cents) differs from header.gst_amount_cents beyond policy tolerance
Then posting is blocked or requires explicit variance reason capture
```

```text
Given a credit note is issued
When credit_note_for_id is missing or references a non-existent invoice
Then posting is blocked and user must select original invoice
```

```text
Given supplier UEN is provided for an InvoiceNow participant
When UEN fails regex validation
Then e-invoice submission is blocked before Access Point handoff
```

```text
Given supplier is not GST-registered
When user attempts to create invoice_type='tax_invoice' with GST amount > 0
Then posting is blocked and user is instructed to issue non-tax invoice
```

## Common Mistakes

- Treating every invoice as a GST tax invoice instead of separating tax invoice, simplified tax invoice, and non-tax invoice flows.
- Omitting supplier GST registration number on GST tax invoices, which can invalidate buyer input-tax claims.
- Allowing credit notes without original-invoice linkage.
- Mixing floating-point math with integer cents for GST totals.
- Generating invoice numbers outside transaction-safe sequence logic.
- Assuming PDF rendering alone is sufficient for InvoiceNow, without structured PINT SG/UBL payload support.

## References

- [IRAS invoice fields and credit-note requirements](references/iras-invoice-fields.md)
- [InvoiceNow, Peppol, PINT SG, and mandate timeline](references/invoicenow-peppol.md)

## Known Simplifications

- This skill does not implement full Peppol transport or UBL XML payload generation.
- This skill does not cover every industry-specific invoicing concession or self-billing arrangement.
- This skill does not model cross-border invoicing tax treatment in full detail.
- This skill does not provide legal, accounting, or tax advice.
