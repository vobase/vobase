---
"@vobase/core": patch
"@vobase/cli": patch
"create-vobase": patch
---

Harden credential store encryption (scryptSync KDF, Buffer handling, ciphertext validation), fix db-migrate mkdir guard and rewrite tests with real SQLite databases, and fix create-vobase giget bundling with --packages=external.
