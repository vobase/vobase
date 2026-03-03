# Singapore SME Starter Chart of Accounts

Starter chart for Singapore SMEs using a 4-digit numbering convention aligned to statement classes.

## Numbering Layout

- `1xxx` Assets (`10xx-14xx` current, `15xx-19xx` non-current)
- `2xxx` Liabilities (`20xx-24xx` current, `25xx-29xx` non-current)
- `3xxx` Equity
- `4xxx` Revenue
- `5xxx` Expenses

## Accounts

| Number | Name | Type | Parent | Notes |
|---|---|---|---|---|
| 1000 | Assets | asset | - | Root heading |
| 1100 | Current Assets | asset | 1000 | Heading |
| 1110 | Cash and Cash Equivalents | asset | 1100 | Heading |
| 1111 | Cash on Hand | asset | 1110 | Leaf posting account |
| 1112 | Bank - Operating | asset | 1110 | Main settlement bank |
| 1113 | Bank - Payroll | asset | 1110 | Optional payroll bank |
| 1120 | Trade Receivables | asset | 1100 | Customer balances |
| 1121 | Allowance for Expected Credit Losses | asset | 1120 | Contra asset |
| 1130 | GST Receivable (Input Tax) | asset | 1100 | Required system account |
| 1140 | Inventory | asset | 1100 | Stock on hand |
| 1150 | Prepaid Expenses | asset | 1100 | Prepayments |
| 1160 | Staff Advances | asset | 1100 | Employee claims/advances |
| 1170 | Other Receivables | asset | 1100 | Non-trade receivables |
| 1500 | Non-Current Assets | asset | 1000 | Heading |
| 1510 | Property, Plant and Equipment | asset | 1500 | Heading |
| 1511 | Office Equipment | asset | 1510 | Leaf posting account |
| 1512 | Computer Equipment | asset | 1510 | Leaf posting account |
| 1513 | Furniture and Fittings | asset | 1510 | Leaf posting account |
| 1520 | Accumulated Depreciation - PPE | asset | 1510 | Contra asset |
| 1530 | Intangible Assets | asset | 1500 | Software, licenses |
| 1540 | Security Deposits | asset | 1500 | Long-term deposits |
| 2000 | Liabilities | liability | - | Root heading |
| 2100 | Current Liabilities | liability | 2000 | Heading |
| 2110 | Trade Payables | liability | 2100 | Supplier balances |
| 2120 | GST Payable (Output Tax) | liability | 2100 | Required system account |
| 2130 | Accrued Expenses | liability | 2100 | Month-end accruals |
| 2140 | Current Portion of Term Loan | liability | 2100 | Due within 12 months |
| 2150 | Payroll Liabilities (CPF/SHG/SDL Clearing) | liability | 2100 | Statutory withholdings |
| 2160 | Deferred Revenue (Current) | liability | 2100 | Unearned income |
| 2500 | Non-Current Liabilities | liability | 2000 | Heading |
| 2510 | Long-term Bank Loan | liability | 2500 | Due after 12 months |
| 2520 | Lease Liabilities (Non-Current) | liability | 2500 | IFRS 16/SFRS(I) 16 style split |
| 3000 | Equity | equity | - | Root heading |
| 3010 | Share Capital | equity | 3000 | Issued capital |
| 3020 | Retained Earnings | equity | 3000 | Prior-year cumulative results |
| 3030 | Current Year Profit/Loss | equity | 3000 | Year-end close target |
| 4000 | Revenue | revenue | - | Root heading |
| 4100 | Operating Revenue | revenue | 4000 | Heading |
| 4110 | Sales - Goods | revenue | 4100 | Core operating income |
| 4120 | Sales - Services | revenue | 4100 | Core operating income |
| 4200 | Other Income | revenue | 4000 | Heading |
| 4210 | Interest Income | revenue | 4200 | Bank interest |
| 4220 | Other Non-Operating Income | revenue | 4200 | Miscellaneous income |
| 5000 | Expenses | expense | - | Root heading |
| 5100 | Cost of Goods Sold | expense | 5000 | Direct cost |
| 5200 | Salaries and Wages | expense | 5000 | Payroll base salary |
| 5210 | Employer CPF Expense | expense | 5000 | Employer CPF contribution |
| 5220 | Rent Expense | expense | 5000 | Premises rent |
| 5230 | Utilities Expense | expense | 5000 | Electricity, internet, water |
| 5240 | Depreciation Expense | expense | 5000 | Period depreciation |
| 5250 | Professional Fees | expense | 5000 | Audit, tax, legal |
| 5260 | Finance Costs | expense | 5000 | Interest and charges |
| 5270 | Software and Subscriptions | expense | 5000 | SaaS tools |
| 5280 | Marketing Expense | expense | 5000 | Campaign spend |
