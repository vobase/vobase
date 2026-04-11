/** Routes that use full-height split-panel layout (no app header, overflow-hidden content) */
const FULL_HEIGHT_PREFIXES = ['/conversations', '/inbox'];

export function isFullHeightRoute(pathname: string): boolean {
  return FULL_HEIGHT_PREFIXES.some((p) => pathname.startsWith(p));
}
