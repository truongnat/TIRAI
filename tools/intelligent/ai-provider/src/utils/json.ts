// ---------------------------------------------------------------------------
// JSON validation utility – schema-based structured output validation
// ---------------------------------------------------------------------------
// Uses Ajv for standards-compliant JSON Schema validation. This ensures
// the provider's response actually conforms to what the caller requested.

import { Ajv, type ErrorObject } from 'ajv';
import { AIProviderError, AIProviderErrorCode } from '../errors.js';
import type { JSONSchema } from '../models.js';

// Ajv instance is expensive to create; reuse a single instance.
// allErrors: collect all validation failures, not just the first.
// strict: false allows non-standard keywords without throwing.
const ajv = new Ajv({ allErrors: true, strict: false });

/**
 * Parse raw text as JSON and validate against the provided schema.
 *
 * @returns The parsed object typed as `T`.
 * @throws AIProviderError with PARSE_ERROR or SCHEMA_ERROR on failure.
 */
export function parseAndValidate<T>(
  rawText: string,
  schema: JSONSchema | undefined,
  providerName: string,
): T {
  // Step 1: Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    throw new AIProviderError({
      code: AIProviderErrorCode.RESPONSE_PARSE_ERROR,
      provider: providerName,
      message: `Response is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      cause: err,
    });
  }

  // Step 2: Validate schema (if provided)
  if (schema) {
    const validate = ajv.compile(schema);
    const valid = validate(parsed);
    if (!valid) {
      const details = validate.errors
        ?.map((e: ErrorObject) => `${e.instancePath || '/'} ${e.message}`)
        .join('; ');
      throw new AIProviderError({
        code: AIProviderErrorCode.RESPONSE_SCHEMA_ERROR,
        provider: providerName,
        message: `Response JSON does not match schema: ${details}`,
      });
    }
  }

  return parsed as T;
}
