---
"@vobase/template": minor
---

# One-click staff WhatsApp phone verification

Staff can verify their own WhatsApp number from anywhere in the app, instead of digging four clicks deep into the edit-profile dialog. Verification stays self-only — the OTP is delivered to the number's owner, so the affordances only ever appear on the signed-in user's own row.

- **Top-right verify nudge** — a persistent toast prompts a signed-in staff member whose own number is set but unverified (typically after they skipped the onboarding verify step), with a one-click "Verify now". A dismissal is remembered for the tab session and the nudge auto-clears the instant the number is verified.
- **Inline "Verify" affordance** — a self-only Verify link in the WhatsApp cell of the team list and the WhatsApp row of the staff profile, shown only on the current user's own unverified row.
- **Focused verify dialog** — a standalone dialog with the saved number pre-filled and editable (so a typo can be fixed before sending), then a 6-digit OTP. All three entry points open it through one global `openPhoneVerify()`.
- **Shared, tested engine** — the nudge gate, the `updatePhoneNumber` self-collision guard, and the OTP error mapping live in one framework-free module with 17 unit tests; the existing edit-profile widget is rewired onto the same code path. No new backend — it reuses better-auth's phone-number plugin and reads the session cast-free via `authClient.$Infer`.
