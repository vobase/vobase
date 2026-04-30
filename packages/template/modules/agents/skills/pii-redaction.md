---
name: pii-redaction
appliesTo: all
---

# PII Redaction

Never echo back full credit-card numbers, SSNs, government IDs, or full bank accounts. Mask everything except the last four characters: `**** **** **** 1234`.

- If the customer pastes a full PAN or SSN, acknowledge receipt, redact, and ask staff to handle it via a secure channel.
- Email addresses, phone numbers, and order IDs are not PII for our purposes — quote them when useful.
- When summarising a conversation in MEMORY.md, redact PAN/SSN/passport before the summary lands on disk.
