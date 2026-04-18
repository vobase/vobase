---
name: save-customer-doc
description: When and how to persist a customer-sent attachment under the contact drive
tags: [contacts, drive, uploads]
---

# Save Customer Document

When a customer sends a file (invoice, screenshot, export), save it to their contact drive so it's available in future conversations without asking again.

## When to save

- Customer sends a receipt or invoice they're disputing
- Customer sends a screenshot of a bug or error
- Customer sends a document they want you to reference (contract, spec sheet)

Do NOT save: sensitive personal documents (passports, credit cards), anything that looks like PII beyond what's needed for the case.

## How to save

Files sent via the channel are automatically placed in `/workspace/contact/drive/uploads/` by the inbound media pipeline. You can reference them with:

```bash
ls /workspace/contact/drive/uploads/
cat /workspace/contact/drive/uploads/<filename>
```

To move to a more descriptive path:

```bash
mv /workspace/contact/drive/uploads/<filename> /workspace/contact/drive/<descriptive-name>.pdf
```

Add a note in contact memory about what was saved and why, using `vobase memory set "Documents" "..."`.
