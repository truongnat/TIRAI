// ---------------------------------------------------------------------------
// Data requirement extractor – AI-driven data requirement extraction
// ---------------------------------------------------------------------------

import type { AIProvider, JSONSchema } from 'ai-provider';
import type {
  DataRequirementExtractionResult,
  TestCaseIRInput,
  TestDataPlannerWarning,
} from '../models.js';
import { TestDataPlannerError, TestDataPlannerErrorCode } from '../errors.js';
import { TestDataPlannerWarningCode } from '../warnings.js';
import { TEST_DATA_PLANNER_SYSTEM_PROMPT } from '../prompts/system.js';
import { buildDataRequirementPrompt } from '../prompts/data-requirement.js';
import { buildDataRepairPrompt } from '../prompts/repair.js';
import { dataRequirementExtractionSchema } from '../schemas/data-schemas.js';
import { adaptDataRequirementRaw } from '../normalization/provider-compat.js';

const DEFAULT_MAX_REPAIR_ATTEMPTS = 1;

/** Lenient schema for json_object mode. */
const lenientObjectSchema: JSONSchema = {
  type: 'object',
  properties: {},
  additionalProperties: true,
};

/**
 * Extract data requirements from test cases using AI.
 */
export async function extractDataRequirements(
  testCases: TestCaseIRInput['testCases'],
  provider: AIProvider,
  maxRepairAttempts: number = DEFAULT_MAX_REPAIR_ATTEMPTS,
  globalDataNeeds?: TestCaseIRInput['dataNeeds'],
): Promise<{
  result: DataRequirementExtractionResult;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  warnings?: TestDataPlannerWarning[];
}> {
  const systemPrompt = TEST_DATA_PLANNER_SYSTEM_PROMPT;
  const userPrompt = buildDataRequirementPrompt(testCases, globalDataNeeds);
  const warnings: TestDataPlannerWarning[] = [];

  const validTCIds = new Set(testCases.map((tc) => tc.id));

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRepairAttempts; attempt++) {
    try {
      const messages = attempt === 0
        ? [
            { role: 'system' as const, content: systemPrompt },
            { role: 'user' as const, content: userPrompt },
          ]
        : [
            { role: 'system' as const, content: systemPrompt },
            { role: 'user' as const, content: userPrompt },
            { role: 'assistant' as const, content: 'My previous response was invalid. Let me correct it.' },
            { role: 'user' as const, content: buildDataRepairPrompt(
              lastError instanceof Error ? lastError.message : String(lastError),
              dataRequirementExtractionSchema,
            ) },
          ];

      const response = await provider.generate<Record<string, unknown>>({
        messages,
        responseSchema: lenientObjectSchema,
        temperature: 0,
      });

      // Provider compatibility adapter: all alias resolution happens here
      const result = adaptDataRequirementRaw(response.data, validTCIds);

      if (attempt > 0) {
        warnings.push({
          code: TestDataPlannerWarningCode.REPAIR_APPLIED,
          message: `Data requirement extraction repair succeeded on attempt ${attempt}`,
        });
      }

      return {
        result,
        usage: response.usage ?? {},
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw new TestDataPlannerError(
    TestDataPlannerErrorCode.SCHEMA_FAILURE,
    `Data requirement extraction failed after ${maxRepairAttempts + 1} attempt(s): ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    lastError,
  );
}

// Re-export for backward compatibility with existing tests
export { adaptDataRequirementRaw as normalizeDataRequirementResult } from '../normalization/provider-compat.js';
