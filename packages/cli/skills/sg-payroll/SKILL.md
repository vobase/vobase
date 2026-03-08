---
name: sg-payroll
description: >-
  Singapore payroll implementation patterns for Vobase modules. Use when
  modeling SDL, FWL, self-help group levies, and MOM-compliant payslip issuance
  with integer-cent accounting and auditable payroll records.
category: vertical
domain: [payroll, hr, singapore, compliance]
enhances: [integer-money, sg-cpf]
version: 1.0.0
last_verified: "2026-03-01"
tier: core
---

# Singapore Payroll (SG)

**Disclaimer:** Levy rates and payslip requirements are current as of 2026-03-01. Verify with MOM and SkillsFuture Singapore before production use.

## Why This Matters

- Late or incorrect itemised payslips create direct compliance risk; under Employment Act enforcement, non-compliance is commonly cited at S$1,000 per offence up to S$5,000 for repeat offences, and MOM may also impose administrative penalties for repeated infringements.
- SDL and FWL are statutory employer liabilities; wrong levy math creates arrears, penalties, and payroll restatement work.
- Self-help group levies are mandatory deductions with race/religion-specific rules and tiered amounts that many payroll implementations miss.
- Payroll defects cascade into CPF submissions, employee disputes, and audit findings because net pay, deductions, and statutory records no longer reconcile.

## Schema Patterns

Extend your CPF payroll schema with explicit SDL, FWL, and self-help levy columns. Keep all money in integer cents.

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const payrollEntries = sqliteTable('payroll_entries', {
  id: text('id').primaryKey(),
  employee_id: text('employee_id').notNull(),
  pay_period_start: integer('pay_period_start', { mode: 'timestamp' }).notNull(),
  pay_period_end: integer('pay_period_end', { mode: 'timestamp' }).notNull(),
  gross_wages_cents: integer('gross_wages_cents').notNull(),

  cpf_employee_cents: integer('cpf_employee_cents').notNull().default(0),
  cpf_employer_cents: integer('cpf_employer_cents').notNull().default(0),

  sdl_cents: integer('sdl_cents').notNull().default(0),
  fwl_cents: integer('fwl_cents').notNull().default(0),
  ethnic_levy_cents: integer('ethnic_levy_cents').notNull().default(0),
  ethnic_levy_type: text('ethnic_levy_type', {
    enum: ['cdac', 'mbmf', 'sinda', 'ecf', 'none'],
  }).notNull().default('none'),
  ethnic_levy_waived: integer('ethnic_levy_waived', { mode: 'boolean' }).notNull().default(false),

  net_pay_cents: integer('net_pay_cents').notNull(),
  payment_date: integer('payment_date', { mode: 'timestamp' }).notNull(),
  created_at: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
});

export const payslipRecords = sqliteTable('payslip_records', {
  id: text('id').primaryKey(),
  payroll_entry_id: text('payroll_entry_id').notNull(),
  employer_name: text('employer_name').notNull(),
  employer_uen: text('employer_uen'),
  employee_name: text('employee_name').notNull(),
  employee_identifier: text('employee_identifier'),
  salary_period_start: integer('salary_period_start', { mode: 'timestamp' }).notNull(),
  salary_period_end: integer('salary_period_end', { mode: 'timestamp' }).notNull(),
  basic_salary_cents: integer('basic_salary_cents').notNull(),
  allowances_cents: integer('allowances_cents').notNull().default(0),
  deductions_cents: integer('deductions_cents').notNull().default(0),
  net_salary_cents: integer('net_salary_cents').notNull(),
  date_of_payment: integer('date_of_payment', { mode: 'timestamp' }).notNull(),
  issued_at: integer('issued_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()),
  issued_via: text('issued_via', { enum: ['email', 'portal', 'hardcopy'] }).notNull(),
});
```

## Business Rules

```typescript
const SDL_RATE = 0.0025; // 0.25% of gross wages
const SDL_MIN_CENTS = 200; // S$2.00 minimum
const SDL_MAX_CENTS = 1125; // S$11.25 maximum
const PAYSLIP_ISSUE_DEADLINE_WORKING_DAYS = 3;
```

- SDL applies to local and foreign employees, computed on monthly wages at 0.25%, with S$2 minimum and S$11.25 maximum per employee per month.
- FWL applies only to pass types that attract levy (for example S Pass and Work Permit); rates vary by pass type, sector, and skill tier.
- Do not apply FWL to levy-exempt pass types (for example Employment Pass).
- Self-help group levy mapping is mandatory when applicable:
  - `cdac`: Chinese employees (SC/PR)
  - `mbmf`: Muslim employees (SC/PR/foreign)
  - `sinda`: Indian-descent employees (SC/PR/EP)
  - `ecf`: Eurasian employees (SC/PR)
- Employees may opt out or vary SHG contributions through the relevant SHG; payroll must store waiver/override evidence and effective dates.
- Issue itemised payslip together with salary payment, or within 3 working days if not issued at payment time.

## Validation Patterns

Use explicit `given / when / then` tests for levy math and deadline checks.

- SDL minimum/maximum cap handling

```text
Given gross_wages_cents = 50_000 (S$500)
When SDL is computed at 0.25%
Then payable SDL is 200 cents (minimum cap), not 125 cents

Given gross_wages_cents = 600_000 (S$6,000)
When SDL is computed at 0.25%
Then payable SDL is 1_125 cents (maximum cap), not 1_500 cents
```

- Non-CMIO or unclassified ethnicity handling

```text
Given employee race is not Chinese, Malay/Muslim, Indian, or Eurasian
When payroll deduction rules are evaluated
Then set ethnic_levy_type = none and require explicit compliance review note
```

- FWL pass-type and sector switching

```text
Given employee changes from Work Permit (services tier) to S Pass mid-cycle
When levy is computed for the payroll month
Then split levy by effective dates and apply each pass-type rate correctly
```

- Payslip issuance lateness

```text
Given payment date is Monday and payslip issued_at is Friday
When working-day deadline is evaluated
Then mark record as late_issuance_breach and compute penalty exposure flag
```

## Common Mistakes

- Forgetting SDL for both local and foreign employees.
- Treating SDL and FWL as the same levy (they are different obligations).
- Using wrong FWL rates when pass type changes between S Pass and Work Permit tiers.
- Skipping SHG deductions without tracking approved waiver/variation evidence.
- Issuing payslips after the 3-working-day window or missing mandatory salary breakdown fields.

## References

- [Levy rates and mapping rules](references/levies.md)
- [MOM payslip requirements and issue deadlines](references/payslip-requirements.md)

## Known Simplifications

- This skill does not cover National Service make-up pay.
- This skill does not cover maternity, paternity, or childcare leave calculations.
- This skill does not cover variable component payment design across complex incentive plans.
- This skill does not cover equity-based compensation treatment.
- This skill does not cover international mobility or shadow payroll.
