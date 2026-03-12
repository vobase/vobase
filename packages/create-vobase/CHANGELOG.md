# create-vobase

## 0.3.0

### Minor Changes

- [`39d2ff1`](https://github.com/vobase/vobase/commit/39d2ff137d841090f21e585661631be581edb973) Thanks [@mdluo](https://github.com/mdluo)! - Support scaffolding into the current directory with `bunx create-vobase@latest .`, requiring a clean git working tree

## 0.2.4

### Patch Changes

- [`fc504cb`](https://github.com/vobase/vobase/commit/fc504cb37187caf1150d2e1dc781ba17f9646d7e) Thanks [@mdluo](https://github.com/mdluo)! - Fix login layout flash, first-click sign-in, and /system blank page redirect

## 0.2.3

### Patch Changes

- [`b2a205d`](https://github.com/vobase/vobase/commit/b2a205d35fc9c3c96ad4b99c532c2e44c9670ccc) Thanks [@mdluo](https://github.com/mdluo)! - Add colored output to scaffolder with green checkmarks and bold headings

## 0.2.2

### Patch Changes

- [`77016c6`](https://github.com/vobase/vobase/commit/77016c6964647e87eae5ff4bc962a0e82f5aefdb) Thanks [@mdluo](https://github.com/mdluo)! - Stub better-sqlite3 so drizzle-kit uses bun:sqlite driver; clean up seed script output

## 0.2.1

### Patch Changes

- [`eb36f3e`](https://github.com/vobase/vobase/commit/eb36f3e8b00547468e9e36a6d2bb2e0f7e12d112) Thanks [@mdluo](https://github.com/mdluo)! - Use stronger default password (Admin@vobase1) for dev admin to avoid browser warnings

## 0.2.0

### Minor Changes

- [`0ec8c7d`](https://github.com/vobase/vobase/commit/0ec8c7deade6d64bd98accde44e10498684dc4db) Thanks [@mdluo](https://github.com/mdluo)! - Rewrite scaffolder for bun-only runtime with full setup flow: resolve workspace deps, generate .env with random secret, create data dir, generate routes, and push schema to SQLite.

## 0.1.2

### Patch Changes

- [`1afa072`](https://github.com/vobase/vobase/commit/1afa072849dd12631138de075c1105015c259133) Thanks [@mdluo](https://github.com/mdluo)! - Replace workspace:\* dependencies with latest published versions when scaffolding a new project.

## 0.1.1

### Patch Changes

- [`6d3049c`](https://github.com/vobase/vobase/commit/6d3049c0cf483416187cace805ff840690ffed1f) Thanks [@mdluo](https://github.com/mdluo)! - Harden credential store encryption (scryptSync KDF, Buffer handling, ciphertext validation), fix db-migrate mkdir guard and rewrite tests with real SQLite databases, and fix create-vobase giget bundling with --packages=external.
