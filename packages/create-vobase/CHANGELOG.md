# create-vobase

## 0.2.0

### Minor Changes

- [`0ec8c7d`](https://github.com/vobase/vobase/commit/0ec8c7deade6d64bd98accde44e10498684dc4db) Thanks [@mdluo](https://github.com/mdluo)! - Rewrite scaffolder for bun-only runtime with full setup flow: resolve workspace deps, generate .env with random secret, create data dir, generate routes, and push schema to SQLite.

## 0.1.2

### Patch Changes

- [`1afa072`](https://github.com/vobase/vobase/commit/1afa072849dd12631138de075c1105015c259133) Thanks [@mdluo](https://github.com/mdluo)! - Replace workspace:\* dependencies with latest published versions when scaffolding a new project.

## 0.1.1

### Patch Changes

- [`6d3049c`](https://github.com/vobase/vobase/commit/6d3049c0cf483416187cace805ff840690ffed1f) Thanks [@mdluo](https://github.com/mdluo)! - Harden credential store encryption (scryptSync KDF, Buffer handling, ciphertext validation), fix db-migrate mkdir guard and rewrite tests with real SQLite databases, and fix create-vobase giget bundling with --packages=external.
