// ---------------------------------------------------------------------------
// Scenario generator – AI-driven scenario extraction
// ---------------------------------------------------------------------------

import type { AIProvider, JSONSchema } from 'ai-provider';
import type {
  ScenarioCandidate,
  ScenarioExtractionResult,
  TestScenarioCategory,
  Priority,
  DataNeedType,
  RequirementIRInput,
  CoverageCandidate,
  TestPlannerWarning,
  TestProvenance,
} from '../models.js';
import { TestPlannerError, TestPlannerErrorCode } from '../errors.js';
import { TestPlannerWarningCode } from '../warnings.js';
import { TEST_PLANNER_SYSTEM_PROMPT } from '../prompts/system.js';
import { buildScenarioPrompt } from '../prompts/scenarios.js';
import { buildRepairPrompt } from '../prompts/repair.js';
import { scenarioExtractionSchema } from '../schemas/test-schemas.js';
import { shouldRepairStructuredOutput } from './provider-retry-policy.js';

const DEFAULT_MAX_REPAIR_ATTEMPTS = 1;
const DEFAULT_CONFIDENCE = 0.7;

const VALID_CATEGORIES: ReadonlySet<string> = new Set([
  'happy-path',
  'negative',
  'validation',
  'boundary',
  'error-handling',
  'state-transition',
  'data-integrity',
  'interface',
  'security',
  'compatibility',
  'other',
]);

const VALID_PRIORITIES: ReadonlySet<string> = new Set(['critical', 'high', 'medium', 'low']);

const VALID_DATA_NEED_TYPES: ReadonlySet<string> = new Set([
  'input',
  'database-record',
  'account',
  'state',
  'external-response',
  'file',
  'configuration',
  'other',
]);

const lenientObjectSchema: JSONSchema = {
  type: 'object',
  properties: {},
  additionalProperties: true,
};

/**
 * Generate scenario candidates from coverage analysis.
 */
export async function generateScenarios(
  requirements: RequirementIRInput['requirements'],
  coverage: CoverageCandidate[],
  provider: AIProvider,
  maxRepairAttempts: number = DEFAULT_MAX_REPAIR_ATTEMPTS,
  coverageMode: 'comprehensive' | 'minimal-sufficient' = 'comprehensive',
): Promise<{
  result: ScenarioExtractionResult;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  warnings?: TestPlannerWarning[];
}> {
  const systemPrompt = TEST_PLANNER_SYSTEM_PROMPT;
  const userPrompt = buildScenarioPrompt(requirements, coverage, coverageMode);
  const warnings: TestPlannerWarning[] = [];

  const validReqIds = new Set(requirements.map((r) => r.id));

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRepairAttempts; attempt++) {
    try {
      const messages =
        attempt === 0
          ? [
              { role: 'system' as const, content: systemPrompt },
              { role: 'user' as const, content: userPrompt },
            ]
          : [
              { role: 'system' as const, content: systemPrompt },
              { role: 'user' as const, content: userPrompt },
              {
                role: 'assistant' as const,
                content: 'My previous response was invalid. Let me correct it.',
              },
              {
                role: 'user' as const,
                content: buildRepairPrompt(
                  lastError instanceof Error ? lastError.message : String(lastError),
                  scenarioExtractionSchema,
                ),
              },
            ];

      const response = await provider.generate<Record<string, unknown>>({
        messages,
        responseSchema: lenientObjectSchema,
        temperature: 0,
        providerOptions: { deepseek: { thinking: 'disabled' } },
      });

      const result = normalizeScenarioResult(response.data, validReqIds);

      if (attempt > 0) {
        warnings.push({
          code: TestPlannerWarningCode.REPAIR_APPLIED,
          message: `Scenario schema repair succeeded on attempt ${attempt}`,
        });
      }

      return {
        result,
        usage: response.usage ?? {},
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (err) {
      if (!shouldRepairStructuredOutput(err)) throw err;
      lastError = err;
    }
  }

  throw new TestPlannerError(
    TestPlannerErrorCode.SCHEMA_FAILURE,
    `Scenario generation failed after ${maxRepairAttempts + 1} attempt(s): ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    lastError,
  );
}

// ---- Normalization --------------------------------------------------------

export function normalizeScenarioResult(
  raw: Record<string, unknown>,
  validReqIds: Set<string>,
): ScenarioExtractionResult {
  const rawScenarios = (Array.isArray(raw.scenarios) ? raw.scenarios : []) as Array<
    Record<string, unknown>
  >;

  let autoId = 0;
  const scenarios: ScenarioCandidate[] = [];

  for (const s of rawScenarios) {
    // Accept title or objective as the title
    const title =
      typeof s.title === 'string' && s.title.length > 0
        ? s.title
        : typeof s.objective === 'string' && s.objective.length > 0
          ? s.objective
          : '';
    if (title.length === 0) continue;

    const objective =
      typeof s.objective === 'string' && s.objective.length > 0 ? s.objective : title;

    const temporaryId =
      typeof s.temporaryId === 'string' && s.temporaryId.length > 0
        ? s.temporaryId
        : typeof s.id === 'string' && s.id.length > 0
          ? s.id
          : `SCN-CAND-${String(++autoId).padStart(3, '0')}`;

    const category =
      typeof s.category === 'string' && VALID_CATEGORIES.has(s.category)
        ? (s.category as TestScenarioCategory)
        : 'other';

    const priority =
      typeof s.priority === 'string' && VALID_PRIORITIES.has(s.priority)
        ? (s.priority as Priority)
        : 'medium';

    // Accept requirementIds, requirements, or linkedRequirements
    const rawReqIds = Array.isArray(s.requirementIds)
      ? s.requirementIds
      : Array.isArray(s.requirements)
        ? s.requirements
        : Array.isArray(s.linkedRequirements)
          ? s.linkedRequirements
          : [];
    const requirementIds = rawReqIds.filter(
      (id): id is string => typeof id === 'string' && validReqIds.has(id),
    );

    if (requirementIds.length === 0) continue;

    const preconditions = normalizePreconditions(s.preconditions);
    const dataNeeds = normalizeDataNeeds(s.dataNeeds, validReqIds);

    // Accept expectedBehavior as array or string
    let expectedBehavior: string[];
    if (Array.isArray(s.expectedBehavior)) {
      expectedBehavior = s.expectedBehavior.filter((b): b is string => typeof b === 'string');
    } else if (typeof s.expectedBehavior === 'string' && s.expectedBehavior.length > 0) {
      expectedBehavior = [s.expectedBehavior];
    } else {
      expectedBehavior = [];
    }

    const provenance = normalizeTestProvenance(s.provenance);
    const confidence = typeof s.confidence === 'number' ? s.confidence : DEFAULT_CONFIDENCE;

    // Build provenance from requirement IDs if empty
    const finalProvenance =
      provenance.length > 0 ? provenance : requirementIds.map((id) => ({ requirementId: id }));

    scenarios.push({
      temporaryId,
      title: title.slice(0, 200),
      objective: objective.slice(0, 500),
      category,
      requirementIds,
      preconditions,
      dataNeeds,
      expectedBehavior,
      priority,
      provenance: finalProvenance,
      confidence,
    });
  }

  return { scenarios };
}

function normalizePreconditions(
  raw: unknown,
): Array<{ description: string; sourceRequirementIds: string[] }> {
  if (typeof raw === 'string' && raw.length > 0) {
    return [{ description: raw, sourceRequirementIds: [] }];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (p): p is Record<string, unknown> =>
        typeof p === 'object' && p !== null && typeof p.description === 'string',
    )
    .map((p) => ({
      description: p.description as string,
      sourceRequirementIds: (Array.isArray(p.sourceRequirementIds)
        ? p.sourceRequirementIds
        : []
      ).filter((id): id is string => typeof id === 'string'),
    }));
}

function normalizeDataNeeds(
  raw: unknown,
  validReqIds: Set<string>,
): Array<{
  description: string;
  type: DataNeedType;
  constraints: string[];
  relatedRequirementIds: string[];
  sourceScenarioId?: string;
  provenance?: TestProvenance[];
}> {
  if (typeof raw === 'string' && raw.length > 0) {
    return [{ description: raw, type: 'other', constraints: [], relatedRequirementIds: [] }];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (d): d is Record<string, unknown> =>
        typeof d === 'object' && d !== null && typeof d.description === 'string',
    )
    .map((d) => {
      const type =
        typeof d.type === 'string' && VALID_DATA_NEED_TYPES.has(d.type)
          ? (d.type as DataNeedType)
          : 'other';

      const relatedRequirementIds = (
        Array.isArray(d.relatedRequirementIds) ? d.relatedRequirementIds : []
      ).filter((id): id is string => typeof id === 'string' && validReqIds.has(id));

      return {
        description: d.description as string,
        type,
        constraints: (Array.isArray(d.constraints) ? d.constraints : []).filter(
          (c): c is string => typeof c === 'string',
        ),
        relatedRequirementIds,
        sourceScenarioId: typeof d.sourceScenarioId === 'string' ? d.sourceScenarioId : undefined,
        provenance: normalizeTestProvenance(d.provenance),
      };
    });
}

function normalizeTestProvenance(raw: unknown): TestProvenance[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (p): p is Record<string, unknown> =>
        typeof p === 'object' && p !== null && typeof p.requirementId === 'string',
    )
    .map((p) => ({
      requirementId: p.requirementId as string,
      contextId: typeof p.contextId === 'string' ? p.contextId : undefined,
      sheet: typeof p.sheet === 'string' ? p.sheet : undefined,
      ranges: Array.isArray(p.ranges)
        ? p.ranges.filter((x): x is string => typeof x === 'string')
        : undefined,
      cells: Array.isArray(p.cells)
        ? p.cells.filter((x): x is string => typeof x === 'string')
        : undefined,
    }));
}
