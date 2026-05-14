---
'@vobase/template': patch
---

feat(auth, team): serial anonymous visitor names + phone-number plugin for staff

## Anonymous visitor names

The better-auth `anonymous` plugin now names fresh public-chat sessions with a
per-day serial — "Visitor B001", "Visitor B002", … — instead of a random id,
so staff see a stable handle in the inbox. The counter is a gap-free sequence
(core's `infra.sequences` table) with a day-of-week letter prefix that resets
daily in the deployment timezone.

## Staff phone via the phone-number plugin

Adds the better-auth `phone-number` plugin and removes the hand-crafted
`staff_profiles.whatsapp_phone_e164` column. Staff phone numbers now live on
the better-auth `user` table (`user.phone_number`):

- The team staff service joins the phone in on read and writes it to the
  `user` row on create/update; a unique-collision surfaces as a typed 409.
- `mention-notify`, `staff-link-sync`, the WhatsApp staff-reply router, and the
  standalone-wake notification mirror all read the phone from the `user` table.
  The platform staff-link wire shape is unchanged.
- The invite dialog gained an optional phone field — it rides the invitation
  row (org-plugin `additionalFields`) and is copied onto the user at sign-in.
- The staff profile form keeps an editable phone field.

Phone-based sign-in is **not** enabled — the plugin's `sendOTP` is a stub seam
for a future SMS/WhatsApp OTP sender.
