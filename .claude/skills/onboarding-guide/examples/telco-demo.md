---
title: "AcmeTelco × Voltade — Demo *Sandbox*"
title_color: purple
eyebrow: "DEMO ONBOARDING"
contact: "yash@voltade.com"
lede: "A live preview of **AcmeBot**, an AI customer-care agent built for AcmeTelco's consumer flows (mobile, fibre, TV, roaming, billing), on Voltade's agent-native helpdesk platform."
quick_access:
---

1. OPEN + SIGN IN
Go to [`demo-telco.voltade.app`](https://demo-telco.voltade.app), enter your `@acmetelco.com` email, paste the 6-digit OTP from your inbox. Only `@acmetelco.com` and `@voltade.com` addresses allowed.

2. ADD YOURSELF AS A TESTER — TWO WAYS
**(a) Web chat — fastest, no setup.** Open [`demo-telco.voltade.app/test-web`](https://demo-telco.voltade.app/test-web) and start typing. The widget posts straight to the same agent your inbox sees.

**(b) WhatsApp — the real production channel.**

1. From the dashboard go to **Channels** → click **Connect platform sandbox** to claim a shared Voltade WhatsApp number from our test pool.
2. A panel appears with a QR + a one-line command like `/link b6e2d419c70a`. Scan the QR with your phone's WhatsApp — it opens the sandbox chat with the link command pre-filled. Send it.
3. Your phone is now a tester. Send any normal message ("hi, what's my data plan billed at this month?") and watch it land in **Inbox** as a real conversation. AcmeBot replies back on WhatsApp.

3. SUGGESTED PROMPTS
> "What's the cheapest data plan with at least 50GB?"
> "Bali roaming charged me $89 even though I activated the roaming add-on — credit?"
> "My fibre at 048660 has been down since 8am — anything you can see?"

4. WHAT'S PRE-LOADED
6 seeded conversations (family plan, SME fibre, roaming dispute, prepaid port, TV bundle, 5G roaming) · AcmeBot knowledge base (`BUSINESS.md`, pricing, ETF, PDPA) · 3 staff teammates with escalation rules (Alex / Sam / Jamie) · Live activity feed of every wake, tool call, and internal note.

5. TWO THINGS WORTH NOTICING
:::cards
### ADAPTIVE SOFTWARE
Same codebase as every Voltade tenant — agent voice, knowledge base, pricing, escalation rules, and staff roster are all **config + seed**, not code. We reshaped this demo into AcmeTelco in hours. Your real deployment edits the same files.
### SELF-LEARNING
AcmeBot writes lessons to its own memory after every conversation. Staff coach it via `@`-mention internal notes — next reply applies the rule. Per-customer + per-staff memory persists across threads. Sharper with use, no retraining.
:::
