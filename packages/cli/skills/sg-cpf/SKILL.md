---
name: sg-cpf
description: >-
  Singapore CPF contribution calculations: employer/employee rates, age-banded
  tables, ordinary/additional wage ceilings, and monthly submission rules.
category: vertical
domain: [payroll, hr, singapore, compliance]
enhances: [integer-money]
version: 1.0.0
last_verified: "2026-03-01"
tier: core
---

# Singapore CPF (SG)

**Disclaimer:** Rates and thresholds are current as of 2026-03-01. Verify with CPF Board before production use.

## Why This Matters

- CPF is a statutory payroll deduction and employer contribution requirement; incorrect computation can produce underpayment exposure, arrears, and penalties.
- CPF records are often cross-checked during payroll, tax, and audit workflows; unreconciled deductions can cascade into filing disputes and remediation work.
- Ceiling errors (ordinary wages vs additional wages) are a high-frequency defect in payroll engines and can over-deduct employees or under-contribute as an employer.
- Correct month-based age and residency rate handling is mandatory for compliant payroll cutovers and year-end reconciliation.

## Schema Patterns

Use integer cents for all wage and contribution fields.

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const cpfContributions = sqliteTable('cpf_contributions', {
  id: text('id').primaryKey(),
  employee_id: text('employee_id').notNull(),
  pay_month: integer('pay_month').notNull(), // YYYYMM
  employee_type: text('employee_type', {
    enum: ['citizen', 'pr_yr1', 'pr_yr2', 'pr_yr3plus'],
  }).notNull(),
  age_band: text('age_band').notNull(),
  ordinary_wages_cents: integer('ordinary_wages_cents').notNull(),
  additional_wages_cents: integer('additional_wages_cents').notNull().default(0),
  employee_contribution_cents: integer('employee_contribution_cents').notNull().default(0),
  employer_contribution_cents: integer('employer_contribution_cents').notNull().default(0),
  total_contribution_cents: integer('total_contribution_cents').notNull().default(0),
})

const CPF_OW_CEILING_CENTS = 600_000        // S$6,000/month
const CPF_AW_CEILING_ANNUAL_CENTS = 10_200_000  // S$102,000/year
```

## Business Rules

- Source (canonical): https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay
- Source (wage treatment): https://www.cpf.gov.sg/employer/employer-obligations/what-payments-attract-cpf-contributions
- Ordinary wages (OW) ceiling: cap monthly ordinary wages at S$6,000 before applying age/residency contribution rates.
- Additional wages (AW) ceiling formula: `S$102,000 - YTD ordinary wages in same calendar year`.
- AW ceiling example: if YTD OW is S$75,000, AW ceiling is `S$102,000 - S$75,000 = S$27,000`; only the first S$27,000 of AW attracts CPF.

Citizen rates (PR Year 3+ uses the same table):

| Age band | Employee % | Employer % | Total % |
| --- | ---: | ---: | ---: |
| <=55 | 20.0 | 17.0 | 37.0 |
| >55 to 60 | 15.0 | 15.0 | 30.0 |
| >60 to 65 | 9.5 | 11.5 | 21.0 |
| >65 to 70 | 7.0 | 9.0 | 16.0 |
| >70 | 5.0 | 7.5 | 12.5 |

- PR rates: `pr_yr1`, `pr_yr2`, and `pr_yr3plus` are not the same; Year 1 and Year 2 are reduced/concessionary relative to citizen rates. Use `references/contribution-rates.md` for implementation tables and keep CPF Board as source of truth.

## Validation Patterns

Use `given / when / then` tests for payroll runs.

```text
Given ordinary_wages_cents = 750_000 and employee_type = citizen, age_band = <=55
When CPF is calculated for the month
Then OW used for CPF is capped at 600_000 cents before contribution rates are applied
```

```text
Given YTD ordinary wages are 9_900_000 cents and additional_wages_cents = 500_000
When annual AW ceiling is computed
Then AW ceiling is 300_000 cents and only 300_000 cents is CPF-applicable
```

```text
Given employee date of birth is 1971-06-10 and pay_month changes from 202605 to 202606
When CPF rates are selected by pay month
Then age band changes starting in the month of the 55th birthday (202606)
```

```text
Given two employees with identical wages and age_band <=55, one citizen and one pr_yr1
When CPF contributions are calculated
Then pr_yr1 contributions differ from citizen contributions using the residency-specific rate table
```

```text
Given payment is director_fee_only or employee is a foreign worker not subject to CPF
When payroll contributions are evaluated
Then CPF contribution is 0 and exemption reason is persisted for audit
```

## Common Mistakes

- Applying citizen rates to PR Year 1 or PR Year 2 employees.
- Using monthly OW calculations without checking AW ceiling at the calendar-year level.
- Missing the month-of-55th-birthday trigger for age-band rate changes.
- Using float arithmetic instead of integer cents for wages and contribution math.

## References

- [CPF contribution rate tables by age and residency](references/contribution-rates.md)
- [Ordinary and additional wage ceiling rules](references/wage-ceiling-rules.md)

## Known Simplifications

- This skill does not include every CPF Board special-case table (for example, all reduced rates by exact wage tier).
- This skill does not implement every exemption class or documentary workflow for non-CPF payments.
- This skill models month-level contribution logic and does not prescribe full payslip rendering requirements.
- This skill is not legal advice and does not replace direct CPF Board confirmation for production payroll.
