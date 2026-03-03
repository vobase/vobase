# CPF Contribution Rate Tables (Singapore)

- Source (canonical): https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay
- last_verified: 2026-03-01

Use these tables as implementation defaults and always confirm current CPF Board publications before production payroll runs.

## Citizen Rates

| Age band | Employee % | Employer % | Total % |
| --- | ---: | ---: | ---: |
| <=55 | 20.0 | 17.0 | 37.0 |
| >55 to 60 | 15.0 | 15.0 | 30.0 |
| >60 to 65 | 9.5 | 11.5 | 21.0 |
| >65 to 70 | 7.0 | 9.0 | 16.0 |
| >70 | 5.0 | 7.5 | 12.5 |

## PR Year 1 Rates

| Age band | Employee % | Employer % | Total % |
| --- | ---: | ---: | ---: |
| <=55 | 5.0 | 4.0 | 9.0 |
| >55 to 60 | 5.0 | 4.0 | 9.0 |
| >60 to 65 | 5.0 | 3.5 | 8.5 |
| >65 to 70 | 5.0 | 3.5 | 8.5 |
| >70 | 5.0 | 3.5 | 8.5 |

## PR Year 2 Rates

| Age band | Employee % | Employer % | Total % |
| --- | ---: | ---: | ---: |
| <=55 | 15.0 | 8.0 | 23.0 |
| >55 to 60 | 12.5 | 6.0 | 18.5 |
| >60 to 65 | 7.5 | 4.5 | 12.0 |
| >65 to 70 | 5.0 | 3.5 | 8.5 |
| >70 | 5.0 | 3.5 | 8.5 |

## PR Year 3+ Rates

PR Year 3+ uses the same rates as citizens.

| Age band | Employee % | Employer % | Total % |
| --- | ---: | ---: | ---: |
| <=55 | 20.0 | 17.0 | 37.0 |
| >55 to 60 | 15.0 | 15.0 | 30.0 |
| >60 to 65 | 9.5 | 11.5 | 21.0 |
| >65 to 70 | 7.0 | 9.0 | 16.0 |
| >70 | 5.0 | 7.5 | 12.5 |

## Lower-Income Graduated Rates Note

CPF Board publishes additional graduated/reduced contribution tables for specific lower-income scenarios and transitions. See CPF Board for the full official table set and monthly applicability rules.

## TypeScript Lookup Pattern

```typescript
type EmployeeType = 'citizen' | 'pr_yr1' | 'pr_yr2' | 'pr_yr3plus'
type AgeBand = '<=55' | '>55_to_60' | '>60_to_65' | '>65_to_70' | '>70'

type RateBps = {
  employee_bps: number
  employer_bps: number
}

const CPF_RATE_TABLE: Record<EmployeeType, Record<AgeBand, RateBps>> = {
  citizen: {
    '<=55': { employee_bps: 2000, employer_bps: 1700 },
    '>55_to_60': { employee_bps: 1500, employer_bps: 1500 },
    '>60_to_65': { employee_bps: 950, employer_bps: 1150 },
    '>65_to_70': { employee_bps: 700, employer_bps: 900 },
    '>70': { employee_bps: 500, employer_bps: 750 },
  },
  pr_yr1: {
    '<=55': { employee_bps: 500, employer_bps: 400 },
    '>55_to_60': { employee_bps: 500, employer_bps: 400 },
    '>60_to_65': { employee_bps: 500, employer_bps: 350 },
    '>65_to_70': { employee_bps: 500, employer_bps: 350 },
    '>70': { employee_bps: 500, employer_bps: 350 },
  },
  pr_yr2: {
    '<=55': { employee_bps: 1500, employer_bps: 800 },
    '>55_to_60': { employee_bps: 1250, employer_bps: 600 },
    '>60_to_65': { employee_bps: 750, employer_bps: 450 },
    '>65_to_70': { employee_bps: 500, employer_bps: 350 },
    '>70': { employee_bps: 500, employer_bps: 350 },
  },
  pr_yr3plus: {
    '<=55': { employee_bps: 2000, employer_bps: 1700 },
    '>55_to_60': { employee_bps: 1500, employer_bps: 1500 },
    '>60_to_65': { employee_bps: 950, employer_bps: 1150 },
    '>65_to_70': { employee_bps: 700, employer_bps: 900 },
    '>70': { employee_bps: 500, employer_bps: 750 },
  },
}

export function getCpfRateBps(employeeType: EmployeeType, ageBand: AgeBand): RateBps {
  return CPF_RATE_TABLE[employeeType][ageBand]
}
```
