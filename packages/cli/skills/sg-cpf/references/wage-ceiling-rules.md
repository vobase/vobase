# CPF Wage Ceiling Rules (Ordinary and Additional Wages)

- Source: https://www.cpf.gov.sg/employer/employer-obligations/what-payments-attract-cpf-contributions
- last_verified: 2026-03-01

## Ordinary Wage (OW) Ceiling

- OW ceiling is S$6,000 per month.
- Integer constant:

```typescript
const CPF_OW_CEILING_CENTS = 600_000
```

Apply OW ceiling before contribution rates are calculated.

## Additional Wage (AW) Ceiling

- Annual AW ceiling formula: `S$102,000 - total OW in that calendar year`.
- Use integer cents for implementation:

```typescript
const CPF_AW_CEILING_ANNUAL_CENTS = 10_200_000
```

## Worked Example

- Employee contractual OW is S$7,000 per month.
- Effective OW for CPF each month is S$6,000 due to the OW ceiling.
- YTD OW after 12 months is `12 x S$6,000 = S$72,000`.
- AW ceiling is `S$102,000 - S$72,000 = S$30,000`.
- Therefore, up to S$30,000 of AW in that year is CPF-applicable.

## Edge Case

If total YTD OW already >= S$102,000 (for example, high earner with sufficient OW in earlier months), AW ceiling is S$0 and no AW attracts CPF for the remainder of that calendar year.

## TypeScript Ceiling Application (Integer Cents)

```typescript
const CPF_OW_CEILING_CENTS = 600_000
const CPF_AW_CEILING_ANNUAL_CENTS = 10_200_000

type CpfCeilingInput = {
  ordinary_wages_cents: number
  additional_wages_cents: number
  ytd_ordinary_wages_cents: number
}

type CpfCeilingOutput = {
  applicable_ordinary_wages_cents: number
  applicable_additional_wages_cents: number
  remaining_aw_ceiling_cents: number
}

export function applyCpfWageCeilings(input: CpfCeilingInput): CpfCeilingOutput {
  const applicable_ordinary_wages_cents = Math.min(input.ordinary_wages_cents, CPF_OW_CEILING_CENTS)

  const remaining_aw_ceiling_cents = Math.max(
    0,
    CPF_AW_CEILING_ANNUAL_CENTS - input.ytd_ordinary_wages_cents,
  )

  const applicable_additional_wages_cents = Math.min(
    input.additional_wages_cents,
    remaining_aw_ceiling_cents,
  )

  return {
    applicable_ordinary_wages_cents,
    applicable_additional_wages_cents,
    remaining_aw_ceiling_cents,
  }
}
```
