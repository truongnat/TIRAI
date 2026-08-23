// ---------------------------------------------------------------------------
// Dependency analyzer – AI-driven dependency and reuse analysis
// ---------------------------------------------------------------------------

import type { AIProvider, JSONSchema } from 'ai-provider';
import type {
  DependencyAnalysisResult,
  DependencyCandidate,
  ReuseCandidate,
  DataRequirementCandidate,
  DataDependencyType,
  ReusePolicy,
  TestDataPlannerWarning,
} from '../models.js';
import { TestDataPlannerError, TestDataPlannerErrorCode } from '../errors.js';
import { TestDataPlannerWarningCode } from '../warnings.js';
import { TEST_DATA_PLANNER_SYSTEM_PROMPT } from '../prompts/system.js';
import { buildDependencyPrompt } from '../prompts/dependency.js';
import { buildDataRepairPrompt } from '../prompts/repair.js';
import { dependencyAnalysisSchema } from '../schemas/data-schemas.js';

const DEFAULT_MAX_REPAIR_ATTEMPTS = 1;

const VALID_DEP_TYPES: ReadonlySet<string> = new Set([
  'requires', 'references', 'derived-from', 'created-after',
  'must-exist-before', 'cleanup-after', 'other',
]);

const VALID_REUSE_POLICIES: ReadonlySet<string> = new Set([
  'safe', 'isolated-copy', 'read-only', 'unknown',
]);

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

      const result = normalizeDependencyResult(response.data, validTempIds);

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

// ---- Normalization --------------------------------------------------------

export function normalizeDependencyResult(
  raw: Record<string, unknown>,
  validTempIds: Set<string>,
): DependencyAnalysisResult {
  const rawDeps = (Array.isArray(raw.dependencyCandidates) ? raw.dependencyCandidates : []) as Array<Record<string, unknown>>;

  // Handle legacy aliases
  if (rawDeps.length === 0 && Array.isArray(raw.dependency_candidates)) {
    rawDeps.push(...(raw.dependency_candidates as Array<Record<string, unknown>>));
  }
  if (rawDeps.length === 0 && Array.isArray(raw.dependencies)) {
    rawDeps.push(...(raw.dependencies as Array<Record<string, unknown>>));
  }

  const dependencyCandidates: DependencyCandidate[] = [];
  for (const d of rawDeps) {
    const source = typeof d.sourceTemporaryId === 'string' ? d.sourceTemporaryId
      : typeof d.source_temporary_id === 'string' ? d.source_temporary_id
      : typeof d.source === 'string' ? d.source
      : typeof d.from === 'string' ? d.from : '';
    const target = typeof d.targetTemporaryId === 'string' ? d.targetTemporaryId
      : typeof d.target_temporary_id === 'string' ? d.target_temporary_id
      : typeof d.target === 'string' ? d.target
      : typeof d.to === 'string' ? d.to : '';

    if (!source || !target) continue;
    if (!validTempIds.has(source) || !validTempIds.has(target)) continue;

    const type = (typeof d.type === 'string' && VALID_DEP_TYPES.has(d.type) ? d.type : 'other') as DataDependencyType;
    const description = typeof d.description === 'string' ? d.description : undefined;

    dependencyCandidates.push({ sourceTemporaryId: source, targetTemporaryId: target, type, description });
  }

  const rawReuse = (Array.isArray(raw.reuseCandidates) ? raw.reuseCandidates : []) as Array<Record<string, unknown>>;

  if (rawReuse.length === 0 && Array.isArray(raw.reuse_candidates)) {
    rawReuse.push(...(raw.reuse_candidates as Array<Record<string, unknown>>));
  }
  if (rawReuse.length === 0 && Array.isArray(raw.reuse_opportunities)) {
    rawReuse.push(...(raw.reuse_opportunities as Array<Record<string, unknown>>));
  }
  if (rawReuse.length === 0 && Array.isArray(raw.reuseSets)) {
    rawReuse.push(...(raw.reuseSets as Array<Record<string, unknown>>));
  }

  const reuseCandidates: ReuseCandidate[] = [];
  for (const r of rawReuse) {
    const ids = Array.isArray(r.temporaryIds) ? r.temporaryIds.filter((v): v is string => typeof v === 'string' && validTempIds.has(v)) : [];
    if (ids.length < 2) continue;

    const reason = typeof r.reason === 'string' ? r.reason : '';
    const reusePolicy = (typeof r.reusePolicy === 'string' && VALID_REUSE_POLICIES.has(r.reusePolicy) ? r.reusePolicy
      : typeof r.reuse_policy === 'string' && VALID_REUSE_POLICIES.has(r.reuse_policy) ? r.reuse_policy
      : 'unknown') as ReusePolicy;

    reuseCandidates.push({ temporaryIds: ids, reason, reusePolicy });
  }

  return { dependencyCandidates, reuseCandidates };
}
