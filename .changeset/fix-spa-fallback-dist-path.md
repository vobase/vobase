---
"@vobase/template": patch
---

fix(template): resolve dist/web from project root in production server

`runtime/bootstrap.ts` computed the SPA dist directory as `join(import.meta.dir, 'dist', 'web')`, which resolves to `/app/runtime/dist/web` at runtime. The Vite build outputs to `/app/dist/web`, so the `index.html` lookup always failed and the static-files block silently no-op'd — every freshly-deployed tenant returned Railway's edge 404 on `/`. Walk one directory up so the path matches the Dockerfile layout.
