// ---------------------------------------------------------------------------
// Test Data Planner – repair prompt
// ---------------------------------------------------------------------------

import type { JSONSchema } from 'ai-provider';

/**
 * Build a repair prompt that tells the AI what went wrong and asks it
 * to produce a valid response.
 */
export function buildDataRepairPrompt(
  errorMessage: string,
  expectedSchema: JSONSchema,
): string {
  return [
    'Your previous response did not match the required schema.',
    '',
    `Error: ${errorMessage}`,
    '',
    'Required schema (simplified):',
    JSON.stringify(expectedSchema, null, 2),
    '',
    'Please respond with valid JSON that matches this schema exactly.',
    'Do NOT include any extra keys. Do NOT omit required keys.',
  ].join('\n');
}
