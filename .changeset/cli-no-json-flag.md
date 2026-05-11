---
"@vobase/cli": patch
---

fix(cli/output): honor `--no-json` by checking `flags.json === false`

cac collapses `--json` and `--no-json` onto the same `flags.json` boolean — `--json` sets it `true`, `--no-json` sets it `false`. `shouldAutoJson` previously only checked `flags.json === true` and `flags['no-json'] === true`, so `--no-json` slipped through to the non-TTY auto-JSON fallback and emitted JSON anyway when piped. Now `flags.json === false` short-circuits to human format.

Also fixes `renderLines` to handle single-object inputs (named-field extraction) so verbs like `messaging notes` return raw markdown under `--no-json` instead of falling through to JSON.
