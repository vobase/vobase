---
name: escalate-to-human
description: Decision tree for reassign vs consult when a human needs to be involved
tags: [messaging, escalation, staff]
---

# Escalate to Human

Two escalation paths — choose based on urgency and reversibility:

## Consult (`vobase consult @staff:<id>`)

Use when you can continue the conversation but want a specialist opinion first. The agent stays assigned; staff reply via the internal notes channel.

Good for:
- Bug reports needing @bob's input before confirming a fix
- Enterprise queries where @alice needs to join the thread

## Reassign (`vobase reassign user:<id>`)

Use when you cannot or should not continue — the conversation needs a human to own it.

Good for:
- Refund disputes > $100
- Legal, security, or SOC2 questions
- Any case where the customer specifically asks for a human

Always add an internal note before reassigning: summarise the issue, what you tried, and why you're handing off.
