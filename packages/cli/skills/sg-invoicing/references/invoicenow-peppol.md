# InvoiceNow and Peppol (Singapore)

## InvoiceNow Overview

InvoiceNow is Singapore's nationwide e-invoicing network, introduced by IMDA in 2019, based on the Peppol standard for structured invoice exchange.

- Businesses exchange invoice data in machine-readable format instead of manual PDF-only workflows.
- GST InvoiceNow compliance requires transmitting invoice data to IRAS through the InvoiceNow network.
- Onboarding typically uses UEN-based registration and issuance of a Peppol ID in the SG Peppol Directory.

Primary sources:

- IMDA InvoiceNow: <https://imda.gov.sg/how-we-can-help/nationwide-e-invoicing-framework/invoicenow>
- IRAS GST InvoiceNow requirement: <https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/gst-invoicenow-requirement>

## PINT SG and Format Expectations

PINT SG (Peppol International Invoice for Singapore) is the Singapore-specific billing profile on Peppol.

- Payloads are aligned to UBL 2.1 semantics for Invoice and Credit Note transactions.
- ERP design should map internal invoice fields to PINT SG semantic groups (seller, buyer, tax totals, monetary totals, line details, references).
- Credit-note exchange is first-class, not an afterthought; model explicit linkage to original invoice IDs/numbers.

Reference specifications:

- PINT SG BIS: <https://docs.peppol.eu/poac/sg/2024-Q1/pint-sg/bis/>
- PINT SG invoice semantic model: <https://docs.peppol.eu/poac/sg/pint-sg/trn-invoice/semantic-model/ibg-25/>

## Access Point Requirement

Sending via Peppol requires connection through an accredited Access Point (AP).

- Businesses using InvoiceNow-ready accounting solutions typically onboard through the solution provider/AP.
- In-house ERP systems must integrate with an IMDA-accredited Access Point to submit to the network and to IRAS GST InvoiceNow flows.

Operational design implications:

- Keep AP transport concerns outside core invoicing tables.
- Persist submission lifecycle fields (queued, sent, acknowledged, rejected) with provider payload references.
- Validate UEN and mandatory data before AP handoff to reduce rejection loops.

Source: IMDA COS 2026 factsheet onboarding steps and AP guidance.

## IMDA/IRAS Rollout Timeline (Current Public Milestones)

Use this timeline as implementation guidance and verify against current IRAS/IMDA notices before go-live.

| Date | Milestone | Source |
|---|---|---|
| 2019 | IMDA introduced InvoiceNow nationwide network | IMDA COS 2026 factsheet |
| 1 Nov 2025 | Newly incorporated companies that voluntarily register for GST required to transmit invoice data to IRAS via InvoiceNow | IMDA COS 2026 factsheet |
| 1 Apr 2026 | All new voluntary GST registrants required to submit invoice data to IRAS via InvoiceNow | IMDA COS 2026 factsheet |
| 1 Apr 2028 | New compulsory GST registrants and existing GST-registered businesses with annual supplies <= S$200,000 onboard phase | IMDA COS 2026 factsheet |
| 1 Apr 2029 | Existing GST-registered businesses with annual supplies <= S$1 million onboard phase | IMDA COS 2026 factsheet |
| 1 Apr 2030 | Existing GST-registered businesses with annual supplies <= S$4 million onboard phase | IMDA COS 2026 factsheet |
| 1 Apr 2031 | Existing GST-registered businesses with annual supplies > S$4 million onboard phase | IMDA COS 2026 factsheet |

Factsheet source:

- <https://www.imda.gov.sg/resources/press-releases-factsheets-and-speeches/factsheets/2026/committee-of-supply-2026>

## UBL XML Note

InvoiceNow/Peppol uses structured documents based on UBL 2.1, but this skill intentionally focuses on compliance mapping and readiness, not full XML implementation.

- Capture all required business fields in your schema and validation layer first.
- Treat XML rendering/signature/transport details as integration-layer concerns.
- Keep a deterministic map from invoice header/lines to PINT SG semantic fields for future AP adapter implementation.
