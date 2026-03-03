# IRAS Invoice Field Requirements (Singapore)

Source baseline: [IRAS - Invoicing customers](https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/basics-of-gst/invoicing-price-display-and-record-keeping/invoicing-customers) and [IRAS - Conditions for claiming input tax](https://www.iras.gov.sg/taxes/goods-services-tax-%28gst%29/claiming-gst-%28input-tax%29/conditions-for-claiming-input-tax).

## Tax Invoice Fields (GST-Registered Supplier)

The following fields should be captured for GST tax invoices to support buyer input-tax claims and auditability.

| Field | GST-Registered Supplier | Non-GST Supplier | Notes |
|---|---|---|---|
| "Tax Invoice" label | Mandatory for tax invoice | Not applicable | Distinguish tax invoice from normal invoice. |
| Supplier name | Mandatory | Mandatory | Legal entity issuing invoice. |
| Supplier address | Mandatory | Mandatory | Business address. |
| Supplier GST registration number | Mandatory | Not applicable | Must not be shown as GST number if supplier is not registered. |
| Invoice date | Mandatory | Mandatory | Issue date of document. |
| Invoice identifying number | Mandatory | Mandatory | Unique reference (use gap-free business sequence where required). |
| Customer name | Mandatory for tax invoice | Usually required operationally | IRAS tax-invoice examples include buyer identity fields. |
| Customer address | Mandatory for tax invoice | Usually required operationally | Include when issuing tax invoice. |
| Description of goods/services | Mandatory | Mandatory | Sufficient detail for audit trail. |
| GST rate (%) | Mandatory where GST is charged | Not applicable | For taxable lines; use 0% where valid zero-rated treatment applies. |
| Value excluding GST | Mandatory | Not applicable if no GST | Taxable value before GST. |
| GST amount | Mandatory | Not applicable | GST charged. |
| Total including GST | Mandatory | Total payable mandatory | Final amount billed. |

## Simplified Tax Invoice

IRAS allows simplified tax invoices in limited scenarios (commonly lower-value retail transactions). Systems should:

- Mark document type explicitly as `simplified_tax_invoice`.
- Enforce only the IRAS-required reduced field set for simplified invoices.
- Prevent misuse for transactions where full tax invoice requirements apply.

See IRAS invoicing page for current threshold/conditions and exceptions.

## Credit Note Requirements

Credit notes are required when reducing or cancelling previously billed amounts where GST treatment is affected.

| Credit Note Requirement | Status | Implementation Guidance |
|---|---|---|
| Unique credit-note number | Mandatory | Separate sequence namespace (for example, `CN-YYYY-0001`). |
| Credit-note date | Mandatory | Timestamp for period attribution. |
| Supplier identity details | Mandatory | Same legal entity controls as invoice. |
| Reference to original invoice | Mandatory | Store `credit_note_for_id` and original invoice number. |
| Reason for credit | Mandatory practice for auditability | Capture machine-readable `reason_code` plus free text. |
| Adjusted taxable value and GST | Mandatory where GST impacted | Store signed delta in cents; keep before/after trace. |

## GST vs Non-GST Behavior Rules

- If supplier is GST-registered: allow `tax_invoice`/`simplified_tax_invoice` paths and require GST fields where applicable.
- If supplier is not GST-registered: block GST charging and block tax-invoice labeling.
- Never permit GST registration number capture as "official" unless registration status is true and number passes validation.

## Rounding and Totals

IRAS accepts consistent calculation methods if applied systematically. To avoid disputes:

- Use integer cents for all stored values.
- Persist a rounding policy key (for example, `line_round_half_up_v1`).
- Record 1-cent variances with explicit reason metadata when supplier and system methods differ.

## Source Links

- IRAS invoicing and tax/simplified/credit note rules: <https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/basics-of-gst/invoicing-price-display-and-record-keeping/invoicing-customers>
- IRAS input tax claim conditions and invalid invoice examples: <https://www.iras.gov.sg/taxes/goods-services-tax-%28gst%29/claiming-gst-%28input-tax%29/conditions-for-claiming-input-tax>
