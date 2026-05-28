---
'@vobase/template': patch
---

fix(messaging): stop attributing WABA echoes and optimistic replies to staff[0]

The renderer parses `[<displayName>] ` body prefixes to identify staff authors. Two cases fell through to the `directory.staff[0]` fallback and showed the first teammate by mistake:

- WhatsApp Business App echoes arrive with `metadata.echoSource === 'business_app'` and no body prefix (Meta only reports the business phone, never the individual sender). `messagePrincipal` now returns `null` for these rows so they render as a generic staff bubble instead of mis-attributing.
- The reply composer's optimistic row inserted the raw, unprefixed body, hitting the same fallback for one frame before the server response replaced it. `useStaffReply` now pre-prefixes the optimistic body with the current staff's display name (mirroring server-side `prefixWithStaffName`), eliminating the flicker.
