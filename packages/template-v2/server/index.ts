/**
 * Public barrel for the template-v2 server package.
 * Frontend (src/) and tests consume everything they need through @server/*.
 * Contracts are imported directly (e.g. `@server/contracts/plugin-context`)
 * because contract files use shared type names that would collide if flattened.
 */

export * from './harness'
export * from './runtime'
export * from './workspace'
