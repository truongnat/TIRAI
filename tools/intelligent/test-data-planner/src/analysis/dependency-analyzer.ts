// ---------------------------------------------------------------------------
// Dependency analyzer – AI-driven dependency and reuse analysis
// ---------------------------------------------------------------------------

import type { AIProvider, JSONSchema } from 'ai-provider';
import type {
  DependencyAnalysisResult,
  DataRequirementCandidate,
  TestDataPlannerWarning,
} from '../models.js';
import { TestDataPlannerError, TestDataPlannerErrorCode } from '../errors.js';
import { TestDataPlannerWarningCode } from '../warnings.js';
import { TEST_DATA_PLANNER_SYSTEM_PROMPT } from '../prompts/system.js';
import { buildDependencyPrompt } from '../prompts/dependency.js';
import { buildDataRepairPrompt } from '../prompts/repair.js';
import { dependencyAnalysisSchema } from '../schemas/data-schemas.js';
import { adaptDependencyRaw } from '../normalization/provider-compat.js';

const DEFAULT_MAX_REPAIR_ATTEMPTS = 1;

const lenientObjectSchema: JSONSchema = {
  type: 'object',
  properties: {},
  additionalProperties: true,
};

/**
 * Analyze dependencies and reuse opportunities using AI.
 */
export async function analyzeDependencies(
  dataCandidates: DataRequirementCandidate[],
  provider: AIProvider,
  maxRepairAttempts: number = DEFAULT_MAX_REPAIR_ATTEMPTS,
): Promise<{
  result: DependencyAnalysisResult;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  warnings?: TestDataPlannerWarning[];
}> {
  const systemPrompt = TEST_DATA_PLANNER_SYSTEM_PROMPT;
  const userPrompt = buildDependencyPrompt(dataCandidates);
  const warnings: TestDataPlannerWarning[] = [];

  const validTempIds = new Set(dataCandidates.map((c) => c.temporaryId));

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
              dependencyAnalysisSchema,
            ) },
          ];

      const response = await provider.generate<Record<string, unknown>>({
        messages,
        responseSchema: lenientObjectSchema,
        temperature: 0,
      });

      // Provider compatibility adapter: all alias resolution happens here
      const result = adaptDependencyRaw(response.data, validTempIds);

      if (attempt > 0) {
        warnings.push({
          code: TestDataPlannerWarningCode.REPAIR_APPLIED,
          message: `Dependency analysis repair succeeded on attempt ${attempt}`,
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
    `Dependency analysis failed after ${maxRepairAttempts + 1} attempt(s): ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    lastError,
  );
}

// Re-export for backward compatibility with existing tests
export { adaptDependencyRaw as normalizeDependencyResult } from '../normalization/provider-compat.js';
