export function isArrayOfNumbers(arr: unknown): arr is number[] {
  if (!Array.isArray(arr)) return false;
  return arr.every((item) => typeof item === 'number');
}

export function isArrayOfDates(arr: unknown): arr is Date[] {
  if (!Array.isArray(arr)) return false;
  return arr.every((item) => item instanceof Date);
}
