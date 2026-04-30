/** Coerce an unknown judge input/output into a string prompt. */
export function coerce(val: unknown): string {
  return typeof val === 'string' ? val : JSON.stringify(val)
}
