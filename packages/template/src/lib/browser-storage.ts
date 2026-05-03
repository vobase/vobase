/** SSR-safe `window.localStorage`. `undefined` on the server so `useDefaultLayout` skips reads. */
const browserStorage = typeof window === 'undefined' ? undefined : window.localStorage

export { browserStorage }
