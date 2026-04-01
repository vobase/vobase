---
"create-vobase": patch
---

Fix PGlite vector extension support in scaffolded projects. The drizzle-kit patch that enables `extensions` passthrough was being stripped during scaffolding, causing `db:push` to fail with `"$libdir/vector": No such file or directory` on any schema using `vector()` columns (e.g. AI module embeddings).
