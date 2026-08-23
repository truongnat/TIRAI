// ---------------------------------------------------------------------------
// Test Planner – repair prompt
// ---------------------------------------------------------------------------

import type { JSONSchema } from 'ai-provider';

/**
 * Build a repair prompt when AI output fails schema validation.
 */
export function buildRepairPrompt(
  originalError: string,
  responseSchema: JSONSchema,
): string {
  return `The previous response did not conform to the required schema.

Error: ${originalError}

Required schema:
${JSON.stringify(responseSchema, null, 2)}

Please provide a corrected response that conforms to this schema.
Do not change the semantic content — only fix the structural issues.
Respond with valid JSON only.`;
}
