// ---------------------------------------------------------------------------
// Requirement Builder – repair prompt
// ---------------------------------------------------------------------------

/**
 * Build a repair prompt that sends the original result + validation errors
 * back to the AI for correction.
 */
export function buildRepairPrompt(
  originalResult: string,
  validationErrors: string[],
): string {
  const parts: string[] = [];

  parts.push('# REPAIR REQUIRED');
  parts.push('');
  parts.push('Your previous response had validation errors:');
  parts.push('');
  for (const err of validationErrors) {
    parts.push(`- ${err}`);
  }
  parts.push('');
  parts.push('Original response:');
  parts.push(originalResult);
  parts.push('');
  parts.push('Please fix the errors and respond with corrected JSON.');
  parts.push('Only fix the reported issues — do not change valid parts.');

  return parts.join('\n');
}
