---
name: cite-policy
description: When and how to grep the drive and quote exact policy text in replies
tags: [drive, policy, citations]
---

# Cite Policy

When a customer asks about a policy (refunds, data export, account deletion, SOC2, pricing), always verify the answer against `/drive/` before replying. Do not rely on memory alone — policies change.

## How to cite

```bash
grep -r "refund" /drive/ --include="*.md" -i
cat /drive/refunds/policy.md
```

Quote the relevant sentence verbatim in your reply, then paraphrase in plain language. Example:

> Our policy states: "14-day money-back on first payment of any plan." That means if you signed up less than 14 days ago, you're fully eligible — I can process that now.

## What not to do

- Do not invent policy details not present in drive files.
- Do not summarise without checking — the drive is the source of truth.
- If a file is missing or unclear, use `vobase consult @carol` (billing) or `vobase consult @alice` (legal/enterprise) before committing to an answer.
