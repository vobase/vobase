---
"@vobase/template": patch
---

fix(wake/trigger): inline new-event body in inbound/staff-note/caption-ready cues

The wake-cue renderer for `inbound_message`, `staff_note`, and `caption_ready` was pointer-only — it told the agent "Read /contacts/<id>/INTERNAL-NOTES.md for context" rather than including the body itself. Models sometimes skipped the follow-up `cat`, replied from stale context, and (e.g.) ignored a staff note like "@MeriGPT yes we are" in favor of a generic "billing team will follow up" stall.

Producers now thread the latest body through the trigger payload (`channels/service/inbound`, two web-channel handlers, `messaging/service/notes` fan-out, `drive/jobs` + `drive/service/files`); the renderer inlines it as a markdown blockquote with an explicit "full thread in …" pointer to the materialized file. Mirrors the operator-thread renderer's existing blockquote pattern.

`truncateForCue` caps the inlined body at 4 KB UTF-8 on a line boundary (marker bytes pre-reserved so the returned string is guaranteed ≤ cap), matching the harness's 4 KB inline tool-stdout budget. All body fields are optional — legacy queue rows mid-deploy fall back to the original pointer-only cue.
