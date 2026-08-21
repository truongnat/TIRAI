// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

/**
 * Convert a 1-based column number to an Excel column letter.
 * A=1, B=2, …, Z=26, AA=27, AB=28, …
 */
export function columnToLetter(col: number): string {
  let result = '';
  let n = col;
  while (n > 0) {
    n--;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

/**
 * Convert Excel column letter(s) to 1-based column number.
 */
export function letterToColumn(letters: string): number {
  let result = 0;
  for (const ch of letters) {
    result = result * 26 + (ch.charCodeAt(0) - 64);
  }
  return result;
}
