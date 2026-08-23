// ---------------------------------------------------------------------------
// Test case generator – AI-driven test case extraction
// ---------------------------------------------------------------------------

import type { AIProvider, JSONSchema } from 'ai-provider';
import type {
  TestCaseCandidate,
  TestCaseExtractionResult,
  TestCaseType,
  Priority,
  ValueStrategy,
  VerificationType,
  DataNeedType,
  AutomationStatus,
  SuggestedExecutor,
  RequirementIRInput,
  ScenarioCandidate,
  TestPlannerWarning,
  TestProvenance,
} from '../models.js';
import { TestPlannerError, TestPlannerErrorCode } from '../errors.js';
import { TestPlannerWarningCode } from '../warnings.js';
import { TEST_PLANNER_SYSTEM_PROMPT } from '../prompts/system.js';
import { buildTestCasePrompt } from '../prompts/test-cases.js';
import { buildRepairPrompt } from '../prompts/repair.js';
import { testCaseExtractionSchema } from '../schemas/test-schemas.js';

const DEFAULT_MAX_REPAIR_ATTEMPTS = 1;
const DEFAULT_CONFIDENCE = 0.7;

const VALID_TYPES: ReadonlySet<string> = new Set([
  'ui', 'api', 'database', 'integration', 'manual', 'unknown',
]);

const VALID_PRIORITIES: ReadonlySet<string> = new Set([
  'critical', 'high', 'medium', 'low',
]);

const VALID_VALUE_STRATEGIES: ReadonlySet<string> = new Set([
  'fixed', 'valid', 'invalid', 'boundary', 'generated', 'existing-data', 'unknown',
]);

const VALID_VERIFICATION_TYPES: ReadonlySet<string> = new Set([
  'ui', 'api', 'database', 'state', 'log', 'other',
]);

const VALID_DATA_NEED_TYPES: ReadonlySet<string> = new Set([
  'input', 'database-record', 'account', 'state', 'external-response',
  'file', 'configuration', 'other',
]);

const VALID_AUTOMATION_STATUSES: ReadonlySet<string> = new Set([
  'ready', 'partially-ready', 'manual-only', 'unknown',
]);

const VALID_SUGGESTED_EXECUTORS: ReadonlySet<string> = new Set([
  'ui', 'api', 'database', 'hybrid',
]);

const lenientObjectSchema: JSONSchema = {
  type: 'object',
  properties: {},
  additionalProperties: true,
};

/**
 * Generate test case candidates from scenarios.
 */
export async function generateTestCases(
  requirements: RequirementIRInput['requirements'],
  scenarios: ScenarioCandidate[],
  provider: AIProvider,
  maxRepairAttempts: number = DEFAULT_MAX_REPAIR_ATTEMPTS,
): Promise<{
  result: TestCaseExtractionResult;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  warnings?: TestPlannerWarning[];
}> {
  const systemPrompt = TEST_PLANNER_SYSTEM_PROMPT;
  const userPrompt = buildTestCasePrompt(requirements, scenarios);
  const warnings: TestPlannerWarning[] = [];

  const validReqIds = new Set(requirements.map((r) => r.id));
  const validScenarioIds = new Set(scenarios.map((s) => s.temporaryId));

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
            { role: 'user' as const, content: buildRepairPrompt(
              lastError instanceof Error ? lastError.message : String(lastError),
              testCaseExtractionSchema,
            ) },
          ];

      const response = await provider.generate<Record<string, unknown>>({
        messages,
        responseSchema: lenientObjectSchema,
        temperature: 0,
      });

      const result = normalizeTestCaseResult(response.data, validReqIds, validScenarioIds);

      if (attempt > 0) {
        warnings.push({
          code: TestPlannerWarningCode.REPAIR_APPLIED,
          message: `Test case schema repair succeeded on attempt ${attempt}`,
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

  throw new TestPlannerError(
    TestPlannerErrorCode.SCHEMA_FAILURE,
    `Test case generation failed after ${maxRepairAttempts + 1} attempt(s): ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    lastError,
  );
}

// ---- Normalization --------------------------------------------------------

export function normalizeTestCaseResult(
  raw: Record<string, unknown>,
  validReqIds: Set<string>,
  validScenarioIds: Set<string>,
): TestCaseExtractionResult {
  const rawTestCases = (Array.isArray(raw.testCases) ? raw.testCases : []) as Array<Record<string, unknown>>;
  
  // Handle DeepSeek format: { "test_cases": [...] } or { "test_case_candidates": [...] }
  if (rawTestCases.length === 0) {
    const tc = Array.isArray(raw.test_cases) ? raw.test_cases 
      : Array.isArray(raw.test_case_candidates) ? raw.test_case_candidates 
      : [];
    if (Array.isArray(tc) && tc.length > 0) {
      rawTestCases.push(...(tc as Array<Record<string, unknown>>));
    }
  }
  
  const rawAdditionalDataNeeds = (Array.isArray(raw.additionalDataNeeds) ? raw.additionalDataNeeds : []) as Array<Record<string, unknown>>;

  let autoId = 0;
  const testCases: TestCaseCandidate[] = [];

  for (const tc of rawTestCases) {
    // Accept title, objective, or description as the title
    const title = typeof tc.title === 'string' && tc.title.length > 0
      ? tc.title
      : typeof tc.objective === 'string' && tc.objective.length > 0
        ? tc.objective
        : typeof tc.description === 'string' && tc.description.length > 0
          ? tc.description
          : '';
    if (title.length === 0) continue;

    const objective = typeof tc.objective === 'string' && tc.objective.length > 0
      ? tc.objective
      : typeof tc.description === 'string' && tc.description.length > 0
        ? tc.description
        : title;

    const temporaryId = (typeof tc.temporaryId === 'string' && tc.temporaryId.length > 0)
      ? tc.temporaryId
      : (typeof tc.id === 'string' && tc.id.length > 0)
        ? tc.id
        : `TC-CAND-${String(++autoId).padStart(3, '0')}`;

    // Accept scenarioTemporaryId, scenarioId, scenario, or scenario_id
    const rawScenarioId = typeof tc.scenarioTemporaryId === 'string' ? tc.scenarioTemporaryId
      : typeof tc.scenarioId === 'string' ? tc.scenarioId
      : typeof tc.scenario === 'string' ? tc.scenario
      : typeof tc.scenario_id === 'string' ? tc.scenario_id
      : '';
    const scenarioTemporaryId = validScenarioIds.has(rawScenarioId) ? rawScenarioId : '';

    if (!scenarioTemporaryId) continue;

    const type = typeof tc.type === 'string' && VALID_TYPES.has(tc.type)
      ? tc.type as TestCaseType
      : 'unknown';

    const priority = typeof tc.priority === 'string' && VALID_PRIORITIES.has(tc.priority)
      ? tc.priority as Priority
      : 'medium';

    // Accept requirementIds, requirements, linkedRequirements, traceability, or requirement_ids
    const rawReqIds = Array.isArray(tc.requirementIds) ? tc.requirementIds
      : Array.isArray(tc.requirements) ? tc.requirements
      : Array.isArray(tc.linkedRequirements) ? tc.linkedRequirements
      : Array.isArray(tc.traceability) ? tc.traceability
      : Array.isArray(tc.requirement_ids) ? tc.requirement_ids
      : [];
    const requirementIds = rawReqIds
      .filter((id): id is string => typeof id === 'string' && validReqIds.has(id));

    const preconditions = normalizePreconditions(tc.preconditions);
    const inputs = normalizeInputs(tc.inputs ?? tc.inputStrategy);
    const dataNeeds = normalizeDataNeeds(tc.dataNeeds, validReqIds);
    const steps = normalizeSteps(tc.steps);
    const expectedResults = normalizeExpectedResults(tc.expectedResults ?? tc.expectedResult);
    const cleanup = normalizeCleanup(tc.cleanup);
    const automation = normalizeAutomation(tc.automation);
    const provenance = normalizeTestProvenance(tc.provenance);
    const confidence = typeof tc.confidence === 'number' ? tc.confidence : DEFAULT_CONFIDENCE;

    // Build provenance from requirement IDs if empty
    const finalProvenance = provenance.length > 0
      ? provenance
      : requirementIds.map((id) => ({ requirementId: id }));

    testCases.push({
      temporaryId,
      scenarioTemporaryId,
      requirementIds,
      title: title.slice(0, 200),
      objective: objective.slice(0, 500),
      type,
      priority,
      preconditions,
      inputs,
      dataNeeds,
      steps,
      expectedResults,
      cleanup,
      automation,
      provenance: finalProvenance,
      confidence,
    });
  }

  const additionalDataNeeds = rawAdditionalDataNeeds
    .filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null && typeof d.description === 'string')
    .map((d) => {
      const type = typeof d.type === 'string' && VALID_DATA_NEED_TYPES.has(d.type)
        ? d.type as DataNeedType
        : 'other';

      return {
        description: d.description as string,
        type,
        constraints: (Array.isArray(d.constraints) ? d.constraints : [])
          .filter((c): c is string => typeof c === 'string'),
        relatedRequirementIds: (Array.isArray(d.relatedRequirementIds) ? d.relatedRequirementIds : [])
          .filter((id): id is string => typeof id === 'string' && validReqIds.has(id)),
      };
    });

  return { testCases, additionalDataNeeds };
}

function normalizePreconditions(raw: unknown): Array<{ description: string; sourceRequirementIds: string[] }> {
  if (typeof raw === 'string' && raw.length > 0) {
    return [{ description: raw, sourceRequirementIds: [] }];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null && typeof p.description === 'string')
    .map((p) => ({
      description: p.description as string,
      sourceRequirementIds: (Array.isArray(p.sourceRequirementIds) ? p.sourceRequirementIds : [])
        .filter((id): id is string => typeof id === 'string'),
    }));
}

function normalizeInputs(raw: unknown): Array<{ name: string; valueStrategy: ValueStrategy; value?: unknown; description?: string }> {
  // Handle string input (e.g., "valid credentials")
  if (typeof raw === 'string' && raw.length > 0) {
    return [{ name: 'input', valueStrategy: 'unknown', description: raw }];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null && typeof i.name === 'string')
    .map((i) => {
      const valueStrategy = typeof i.valueStrategy === 'string' && VALID_VALUE_STRATEGIES.has(i.valueStrategy)
        ? i.valueStrategy as ValueStrategy
        : 'unknown';

      return {
        name: i.name as string,
        valueStrategy,
        value: i.value,
        description: typeof i.description === 'string' ? i.description : undefined,
      };
    });
}

function normalizeDataNeeds(
  raw: unknown,
  validReqIds: Set<string>,
): Array<{ description: string; type: DataNeedType; constraints: string[]; relatedRequirementIds: string[] }> {
  if (typeof raw === 'string' && raw.length > 0) {
    return [{ description: raw, type: 'other', constraints: [], relatedRequirementIds: [] }];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null && typeof d.description === 'string')
    .map((d) => {
      const type = typeof d.type === 'string' && VALID_DATA_NEED_TYPES.has(d.type)
        ? d.type as DataNeedType
        : 'other';

      return {
        description: d.description as string,
        type,
        constraints: (Array.isArray(d.constraints) ? d.constraints : [])
          .filter((c): c is string => typeof c === 'string'),
        relatedRequirementIds: (Array.isArray(d.relatedRequirementIds) ? d.relatedRequirementIds : [])
          .filter((id): id is string => typeof id === 'string' && validReqIds.has(id)),
      };
    });
}

function normalizeSteps(raw: unknown): Array<{ order: number; action: string; target?: string; input?: string; expectedIntermediateResult?: string }> {
  if (!Array.isArray(raw)) return [];
  // Handle array of strings
  if (raw.every((s) => typeof s === 'string')) {
    return raw.map((s, idx) => ({ order: idx + 1, action: s as string }));
  }
  return raw
    .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null && typeof s.action === 'string')
    .map((s, idx) => ({
      order: typeof s.order === 'number' ? s.order : idx + 1,
      action: s.action as string,
      target: typeof s.target === 'string' ? s.target : undefined,
      input: typeof s.input === 'string' ? s.input : undefined,
      expectedIntermediateResult: typeof s.expectedIntermediateResult === 'string' ? s.expectedIntermediateResult : undefined,
    }));
}

function normalizeExpectedResults(raw: unknown): Array<{ description: string; verificationType: VerificationType; target?: string }> {
  // Handle single string result
  if (typeof raw === 'string' && raw.length > 0) {
    return [{ description: raw, verificationType: 'other' }];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null && typeof e.description === 'string')
    .map((e) => {
      const verificationType = typeof e.verificationType === 'string' && VALID_VERIFICATION_TYPES.has(e.verificationType)
        ? e.verificationType as VerificationType
        : 'other';

      return {
        description: e.description as string,
        verificationType,
        target: typeof e.target === 'string' ? e.target : undefined,
      };
    });
}

function normalizeCleanup(raw: unknown): Array<{ description: string; target?: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null && typeof c.description === 'string')
    .map((c) => ({
      description: c.description as string,
      target: typeof c.target === 'string' ? c.target : undefined,
    }));
}

function normalizeAutomation(raw: unknown): { status: AutomationStatus; suggestedExecutor?: SuggestedExecutor; reasons: string[] } {
  if (typeof raw !== 'object' || raw === null) {
    return { status: 'unknown', reasons: ['Automation assessment not provided'] };
  }

  const r = raw as Record<string, unknown>;
  const status = typeof r.status === 'string' && VALID_AUTOMATION_STATUSES.has(r.status)
    ? r.status as AutomationStatus
    : 'unknown';

  const suggestedExecutor = typeof r.suggestedExecutor === 'string' && VALID_SUGGESTED_EXECUTORS.has(r.suggestedExecutor)
    ? r.suggestedExecutor as SuggestedExecutor
    : undefined;

  const reasons = (Array.isArray(r.reasons) ? r.reasons : [])
    .filter((reason): reason is string => typeof reason === 'string');

  return { status, suggestedExecutor, reasons };
}

function normalizeTestProvenance(raw: unknown): TestProvenance[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null && typeof p.requirementId === 'string')
    .map((p) => ({
      requirementId: p.requirementId as string,
      contextId: typeof p.contextId === 'string' ? p.contextId : undefined,
      sheet: typeof p.sheet === 'string' ? p.sheet : undefined,
      ranges: Array.isArray(p.ranges) ? p.ranges.filter((x): x is string => typeof x === 'string') : undefined,
    }));
}
