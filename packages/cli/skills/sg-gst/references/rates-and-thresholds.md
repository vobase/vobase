# Singapore GST Rates and Thresholds

Last verified: 2026-03-01

## Constants

```ts
const GST_STANDARD_RATE = 0.09; // 9% (IRAS: https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/basics-of-gst/current-gst-rates)
const GST_ZERO_RATE = 0.0; // 0% for qualifying zero-rated supplies (IRAS: https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/charging-gst-(output-tax)/when-to-charge-0-gst-(zero-rate))
const GST_EXEMPT_RATE = 0.0; // no GST charged on exempt supplies (IRAS: https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/charging-gst-(output-tax)/when-is-gst-not-charged)
const REGISTRATION_THRESHOLD_SGD = 1_000_000; // S$1M taxable turnover (IRAS: https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/gst-registration-deregistration/do-i-need-to-register-for-gst)
const REGISTRATION_THRESHOLD_CENTS = 100_000_000; // S$1,000,000 * 100
const REVERSE_CHARGE_IMPORTED_SERVICES_THRESHOLD_SGD = 1_000_000; // RC annual imported services condition reference (IRAS RC e-Tax guide)
```

## Current Rates and Thresholds

| Item | Current Value | Effective Date / Condition | IRAS Source |
| --- | --- | --- | --- |
| Standard-rated GST | 9% | Applies to standard-rated supplies from 1 Jan 2024 | [Current GST rates](https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/basics-of-gst/current-gst-rates) |
| Zero-rated GST | 0% | Exports of goods and prescribed international services | [When to charge 0% GST](https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/charging-gst-(output-tax)/when-to-charge-0-gst-(zero-rate)) |
| Exempt supplies | No GST charged | Applies to exempt categories (for example, qualifying financial services, sale/lease of residential property) | [When GST is not charged](https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/charging-gst-(output-tax)/when-is-gst-not-charged) |
| Compulsory GST registration threshold | S$1,000,000 taxable turnover | Retrospective or prospective 12-month tests | [Do I need to register for GST](https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/gst-registration-deregistration/do-i-need-to-register-for-gst) |
| Reverse charge imported services threshold (condition) | > S$1,000,000 annual imported services value test | Applies only with other RC eligibility conditions | [GST: Reverse Charge e-Tax guide](https://www.iras.gov.sg/media/docs/default-source/e-tax/gst-taxing-imported-services-by-way-of-reverse-charge-(2nd-edition).pdf) |

## Rate Change History (Recent)

| Period | GST Rate | IRAS Source |
| --- | --- | --- |
| Up to 31 Dec 2022 | 7% | [Overview of GST rate change](https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/gst-rate-change/gst-rate-change-for-business/overview-of-gst-rate-change) |
| 1 Jan 2023 to 31 Dec 2023 | 8% | [Overview of GST rate change](https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/gst-rate-change/gst-rate-change-for-business/overview-of-gst-rate-change) |
| From 1 Jan 2024 | 9% | [Overview of GST rate change](https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/gst-rate-change/gst-rate-change-for-business/overview-of-gst-rate-change) |

## Implementation Notes

- Persist GST rate in basis points (`gst_rate_bps`) on each transaction line; never infer historical rate from current settings.
- Keep tax code (`SR`, `ZR`, `ES`, `OS`) and numerical rate as separate fields.
- Record threshold checks as dated events (`checked_at`, `basis`, `turnover_window_start`, `turnover_window_end`, `result`) for auditability.
- RC threshold checks should be logged independently from registration threshold checks.
