import { AIProviderError, AIProviderErrorCode } from 'ai-provider';

/**
 * Planner repair is for malformed/unsupported structured output only.
 * Transport resiliency belongs to the provider, whose configured retry
 * policy is the single owner for request retries.
 */
export function shouldRepairStructuredOutput(error: unknown): boolean {
  if (!(error instanceof AIProviderError)) return true;

  return new Set<AIProviderError['code']>([
    AIProviderErrorCode.RESPONSE_EMPTY,
    AIProviderErrorCode.RESPONSE_PARSE_ERROR,
    AIProviderErrorCode.RESPONSE_SCHEMA_ERROR,
    AIProviderErrorCode.OUTPUT_LIMIT_EXCEEDED,
  ]).has(error.code);
}
