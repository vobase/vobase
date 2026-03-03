# Singapore GST Filing Rules (F5)

Last verified: 2026-03-01

## Filing Constants

```ts
const DEFAULT_FILING_FREQUENCY = 'quarterly'; // IRAS default for most GST-registered businesses
const SPECIAL_FILING_FREQUENCIES = ['monthly', 'quarterly']; // model as configurable; IRAS can assign special periods
const FILING_DEADLINE_MONTHS_AFTER_PERIOD_END = 1; // IRAS due date rule
const LATE_SUBMISSION_PENALTY_SGD = 200; // per completed month outstanding return
const LATE_SUBMISSION_MAX_PER_RETURN_SGD = 10_000;
const LATE_PAYMENT_SURCHARGE_RATE = 0.05; // 5% of unpaid tax
```

Sources: [Due dates and requests for extension](https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/filing-gst/due-dates-and-requests-for-extension), [Late filing/non-filing](https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/filing-gst/late-filing-or-non-filing-of-GST-returns-f5-f8), [GST F5 online help](https://mytax.iras.gov.sg/ESVWeb/default.aspx?target=GSTF5OnlineHelp), [Late payment/non-payment](https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/gst-payments-refunds/late-payment-or-non-payment-of-gst).

## Filing Period and Deadline Rules

- Default cycle is quarterly for most businesses.
- IRAS may assign special accounting periods (model as configurable; monthly periods are common for high-volume/refund profiles).
- F5 submission and payment due date is one month after the end of the accounting period.
- If no activity occurred, a nil return is still mandatory.

Example default quarterly due dates (without GIRO):

| Accounting period | Due date |
| --- | --- |
| Jan to Mar | 30 Apr |
| Apr to Jun | 31 Jul |
| Jul to Sep | 31 Oct |
| Oct to Dec | 31 Jan |

## F5 Return Logic (Boxes 1 to 14)

Reference: [GST F5 Online Help](https://mytax.iras.gov.sg/ESVWeb/default.aspx?target=GSTF5OnlineHelp)

| Box | Meaning | ERP mapping guidance |
| --- | --- | --- |
| 1 | Total value of standard-rated supplies | Sum taxable value for `SR` output supplies; exclude GST amount |
| 2 | Total value of zero-rated supplies | Sum taxable value for `ZR` supplies |
| 3 | Total value of exempt supplies | Sum exempt supply value (`ES`) |
| 4 | Total supplies | Compute as Box 1 + Box 2 + Box 3 |
| 5 | Total value of taxable purchases | Sum taxable purchase value eligible for GST reporting; exclude disallowed input-tax categories |
| 6 | Output tax due | Sum GST amounts on standard-rated output and relevant adjustments |
| 7 | Input tax and refunds claimed | Sum claimable input GST plus valid GST refunds/reliefs |
| 8 | Net GST to pay/claim | `Box 6 - Box 7` |
| 9 | Value of imports under MES/3PL/other approved schemes | Separate import-value tracking for approved-scheme entities |
| 10 | Tourist refund GST claim indicator | Flag and amount where applicable |
| 11 | Bad debt relief claim indicator | Flag and amount where applicable |
| 12 | Pre-registration claim indicator | First-return-only flag and amount |
| 13 | Revenue | Operational revenue (not identical to total supplies in all cases) |
| 14 | Net GST per Box 8 | Auto-derived value (especially relevant with IGDS workflow variants) |

## Penalty and Enforcement Rules

- Late submission penalty: S$200 for every completed month an F5 remains outstanding, capped at S$10,000 per return.
- Late payment surcharge: 5% on unpaid tax.
- If unpaid after 60 days, additional 2% per completed month may apply (subject to cap in IRAS guidance).
- Non-filing can trigger estimated assessment, recovery actions, and prosecution workflows.

## Suggested Data Model for Filing Engine

```ts
type GstReturnPeriod = {
  id: string;
  entityId: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  filingFrequency: 'monthly' | 'quarterly';
  status: 'open' | 'filed' | 'late' | 'amended';
  boxes: {
    box1Cents: number;
    box2Cents: number;
    box3Cents: number;
    box4Cents: number;
    box5Cents: number;
    box6Cents: number;
    box7Cents: number;
    box8Cents: number;
    box9Cents: number;
    box13Cents: number;
    box14Cents: number;
  };
};
```

## Validation Checklist Before Filing Lock

- Box-level sums reconcile to transaction-level tax ledger.
- Credit notes and debit notes are reflected in both taxable value and GST value.
- Nil periods are explicitly filed (not skipped).
- Deadline breach state machine (`open -> late -> filed`) is auditable.
- Penalty computations are reproducible from stored dates and unpaid balances.
