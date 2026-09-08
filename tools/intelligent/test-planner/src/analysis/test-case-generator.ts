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
  VerificationIntent,
} from '../models.js';
import { TestPlannerError, TestPlannerErrorCode } from '../errors.js';
import { TestPlannerWarningCode } from '../warnings.js';
import { TEST_PLANNER_SYSTEM_PROMPT } from '../prompts/system.js';
import { buildTestCasePrompt } from '../prompts/test-cases.js';
import { buildRepairPrompt } from '../prompts/repair.js';
import { testCaseExtractionSchema } from '../schemas/test-schemas.js';
import { shouldRepairStructuredOutput } from './provider-retry-policy.js';

const DEFAULT_MAX_REPAIR_ATTEMPTS = 1;
const DEFAULT_CONFIDENCE = 0.7;

const VALID_TYPES: ReadonlySet<string> = new Set([
  'ui',
  'api',
  'database',
  'integration',
  'manual',
  'unknown',
]);

const VALID_PRIORITIES: ReadonlySet<string> = new Set(['critical', 'high', 'medium', 'low']);

const VALID_VALUE_STRATEGIES: ReadonlySet<string> = new Set([
  'fixed',
  'valid',
  'invalid',
  'boundary',
  'generated',
  'existing-data',
  'unknown',
]);

const VALID_VERIFICATION_TYPES: ReadonlySet<string> = new Set([
  'ui',
  'api',
  'database',
  'state',
  'log',
  'other',
]);

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

const VALID_AUTOMATION_STATUSES: ReadonlySet<string> = new Set([
  'ready',
  'partially-ready',
  'manual-only',
  'unknown',
]);

const VALID_SUGGESTED_EXECUTORS: ReadonlySet<string> = new Set(['ui', 'api', 'database', 'hybrid']);

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
  coverageMode: 'comprehensive' | 'minimal-sufficient' = 'comprehensive',
): Promise<{
  result: TestCaseExtractionResult;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  warnings?: TestPlannerWarning[];
}> {
  const warnings: TestPlannerWarning[] = [];
  const validReqIds = new Set(requirements.map((r) => r.id));
  const validScenarioIds = new Set(scenarios.map((s) => s.temporaryId));
  const batchSize = Math.max(1, Number(process.env.TIRAI_TESTCASE_BATCH_SIZE) || 4);
  const allCases: TestCaseCandidate[] = [];
  const allAdditionalDataNeeds: TestCaseExtractionResult['additionalDataNeeds'] = [];
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  const batches = scenarios.length === 0 ? [[]] : Array.from({ length: Math.ceil(scenarios.length / batchSize) }, (_, index) => scenarios.slice(index * batchSize, (index + 1) * batchSize));
  for (const batch of batches) {
    const part = await generateTestCasesForBatch(
      requirements,
      batch,
      provider,
      maxRepairAttempts,
      coverageMode,
      validReqIds,
      validScenarioIds,
    );
    allCases.push(...part.result.testCases);
    allAdditionalDataNeeds.push(...part.result.additionalDataNeeds);
    usage.inputTokens += part.usage.inputTokens ?? 0;
    usage.outputTokens += part.usage.outputTokens ?? 0;
    usage.totalTokens += part.usage.totalTokens ?? 0;
    if (part.warnings) warnings.push(...part.warnings);
  }

  return {
    result: { testCases: allCases, additionalDataNeeds: allAdditionalDataNeeds },
    usage,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

async function generateTestCasesForBatch(
  requirements: RequirementIRInput['requirements'],
  scenarios: ScenarioCandidate[],
  provider: AIProvider,
  maxRepairAttempts: number,
  coverageMode: 'comprehensive' | 'minimal-sufficient',
  validReqIds: Set<string>,
  validScenarioIds: Set<string>,
): Promise<{
  result: TestCaseExtractionResult;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  warnings?: TestPlannerWarning[];
}> {
  const systemPrompt = TEST_PLANNER_SYSTEM_PROMPT;
  const userPrompt = `${buildTestCasePrompt(requirements, scenarios, coverageMode)}\n\nGenerate at most 2 test cases per scenario in this batch. Prefer concrete input values when the spec states them.`;
  const warnings: TestPlannerWarning[] = [];

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
                  testCaseExtractionSchema,
                ),
              },
            ];

      const response = await provider.generate<Record<string, unknown>>({
        messages,
        responseSchema: lenientObjectSchema,
        temperature: 0,
        providerOptions: { deepseek: { thinking: 'disabled' } },
      });

      const result = normalizeTestCaseResult(response.data, validReqIds, validScenarioIds);
      if (result.warnings) warnings.push(...result.warnings);

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
      if (!shouldRepairStructuredOutput(err)) throw err;
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
  const rawTestCases = (Array.isArray(raw.testCases) ? raw.testCases : []) as Array<
    Record<string, unknown>
  >;

  // Handle DeepSeek format: { "test_cases": [...] } or { "test_case_candidates": [...] }
  if (rawTestCases.length === 0) {
    const tc = Array.isArray(raw.test_cases)
      ? raw.test_cases
      : Array.isArray(raw.test_case_candidates)
        ? raw.test_case_candidates
        : [];
    if (Array.isArray(tc) && tc.length > 0) {
      rawTestCases.push(...(tc as Array<Record<string, unknown>>));
    }
  }

  const rawAdditionalDataNeeds = (
    Array.isArray(raw.additionalDataNeeds) ? raw.additionalDataNeeds : []
  ) as Array<Record<string, unknown>>;

  let autoId = 0;
  const testCases: TestCaseCandidate[] = [];
  const normalizationWarnings: TestPlannerWarning[] = [];

  for (const tc of rawTestCases) {
    // Accept title, objective, or description as the title
    const title =
      typeof tc.title === 'string' && tc.title.length > 0
        ? tc.title
        : typeof tc.objective === 'string' && tc.objective.length > 0
          ? tc.objective
          : typeof tc.description === 'string' && tc.description.length > 0
            ? tc.description
            : '';
    if (title.length === 0) continue;

    const objective =
      typeof tc.objective === 'string' && tc.objective.length > 0
        ? tc.objective
        : typeof tc.description === 'string' && tc.description.length > 0
          ? tc.description
          : title;

    const temporaryId =
      typeof tc.temporaryId === 'string' && tc.temporaryId.length > 0
        ? tc.temporaryId
        : typeof tc.id === 'string' && tc.id.length > 0
          ? tc.id
          : `TC-CAND-${String(++autoId).padStart(3, '0')}`;

    // Accept scenarioTemporaryId, scenarioId, scenario, or scenario_id
    const rawScenarioId =
      typeof tc.scenarioTemporaryId === 'string'
        ? tc.scenarioTemporaryId
        : typeof tc.scenarioId === 'string'
          ? tc.scenarioId
          : typeof tc.scenario === 'string'
            ? tc.scenario
            : typeof tc.scenario_id === 'string'
              ? tc.scenario_id
              : '';
    const scenarioTemporaryId = validScenarioIds.has(rawScenarioId) ? rawScenarioId : '';

    if (!scenarioTemporaryId) continue;

    const type =
      typeof tc.type === 'string' && VALID_TYPES.has(tc.type)
        ? (tc.type as TestCaseType)
        : 'unknown';

    const priority =
      typeof tc.priority === 'string' && VALID_PRIORITIES.has(tc.priority)
        ? (tc.priority as Priority)
        : 'medium';

    // Accept requirementIds, requirements, linkedRequirements, traceability, or requirement_ids
    const rawReqIds = Array.isArray(tc.requirementIds)
      ? tc.requirementIds
      : Array.isArray(tc.requirements)
        ? tc.requirements
        : Array.isArray(tc.linkedRequirements)
          ? tc.linkedRequirements
          : Array.isArray(tc.traceability)
            ? tc.traceability
            : Array.isArray(tc.requirement_ids)
              ? tc.requirement_ids
              : [];
    const requirementIds = rawReqIds.filter(
      (id): id is string => typeof id === 'string' && validReqIds.has(id),
    );

    const preconditions = normalizePreconditions(tc.preconditions);
    const inputs = normalizeInputs(tc.inputs ?? tc.inputStrategy);
    const dataNeeds = normalizeDataNeeds(tc.dataNeeds, validReqIds);
    const steps = normalizeSteps(tc.steps);
    const expectedResults = normalizeExpectedResults(tc.expectedResults ?? tc.expectedResult);
    const cleanup = normalizeCleanup(tc.cleanup);
    const automation = normalizeAutomation(tc.automation);
    if (
      typeof tc.automation !== 'object' ||
      tc.automation === null ||
      (typeof (tc.automation as Record<string, unknown>).status === 'string' &&
        !VALID_AUTOMATION_STATUSES.has((tc.automation as Record<string, unknown>).status as string))
    ) {
      normalizationWarnings.push({
        code: TestPlannerWarningCode.CASE_UNSUPPORTED_AUTOMATION,
        message: `Test case ${temporaryId} has unknown automation status`,
      });
    }
    const rawExpectedResults = tc.expectedResults ?? tc.expectedResult;
    if (Array.isArray(rawExpectedResults)) {
      for (const expected of rawExpectedResults) {
        const intent = normalizeVerificationIntent((expected as Record<string, unknown>).verificationIntent);
        if (
          typeof expected === 'object' &&
          expected !== null &&
          typeof (expected as Record<string, unknown>).verificationType === 'string' &&
          !VALID_VERIFICATION_TYPES.has(
            (expected as Record<string, unknown>).verificationType as string,
          ) && !intent
        ) {
          normalizationWarnings.push({
            code: TestPlannerWarningCode.EXPECTATION_UNTRACEABLE,
            message: `Test case ${temporaryId} contains an unsupported verification type; planner intent was rejected`,
          });
        }
      }
    }
    const provenance = normalizeTestProvenance(tc.provenance);
    const confidence = typeof tc.confidence === 'number' ? tc.confidence : DEFAULT_CONFIDENCE;

    // Build provenance from requirement IDs if empty
    const finalProvenance =
      provenance.length > 0 ? provenance : requirementIds.map((id) => ({ requirementId: id }));

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
    .filter(
      (d): d is Record<string, unknown> =>
        typeof d === 'object' && d !== null && typeof d.description === 'string',
    )
    .map((d) => {
      const type =
        typeof d.type === 'string' && VALID_DATA_NEED_TYPES.has(d.type)
          ? (d.type as DataNeedType)
          : 'other';

      return {
        description: d.description as string,
        type,
        constraints: (Array.isArray(d.constraints) ? d.constraints : []).filter(
          (c): c is string => typeof c === 'string',
        ),
        relatedRequirementIds: (Array.isArray(d.relatedRequirementIds)
          ? d.relatedRequirementIds
          : []
        ).filter((id): id is string => typeof id === 'string' && validReqIds.has(id)),
      };
    });

  return { testCases, additionalDataNeeds, warnings: normalizationWarnings };
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

function normalizeInputs(
  raw: unknown,
): Array<{ name: string; valueStrategy: ValueStrategy; value?: unknown; description?: string }> {
  // Handle string input (e.g., "valid credentials")
  if (typeof raw === 'string' && raw.length > 0) {
    return [{ name: 'input', valueStrategy: 'unknown', description: raw }];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (i): i is Record<string, unknown> =>
        typeof i === 'object' && i !== null && typeof i.name === 'string',
    )
    .map((i) => {
      const valueStrategy =
        typeof i.valueStrategy === 'string' && VALID_VALUE_STRATEGIES.has(i.valueStrategy)
          ? (i.valueStrategy as ValueStrategy)
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

      return {
        description: d.description as string,
        type,
        constraints: (Array.isArray(d.constraints) ? d.constraints : []).filter(
          (c): c is string => typeof c === 'string',
        ),
        relatedRequirementIds: (Array.isArray(d.relatedRequirementIds)
          ? d.relatedRequirementIds
          : []
        ).filter((id): id is string => typeof id === 'string' && validReqIds.has(id)),
        sourceScenarioId: typeof d.sourceScenarioId === 'string' ? d.sourceScenarioId : undefined,
        provenance: normalizeTestProvenance(d.provenance),
      };
    });
}

function normalizeSteps(
  raw: unknown,
): Array<{
  order: number;
  action: string;
  target?: string;
  input?: string;
  expectedIntermediateResult?: string;
}> {
  if (!Array.isArray(raw)) return [];
  // Handle array of strings
  if (raw.every((s) => typeof s === 'string')) {
    return raw.map((s, idx) => ({ order: idx + 1, action: s as string }));
  }
  return raw
    .filter(
      (s): s is Record<string, unknown> =>
        typeof s === 'object' && s !== null && typeof s.action === 'string',
    )
    .map((s, idx) => ({
      order: typeof s.order === 'number' ? s.order : idx + 1,
      action: s.action as string,
      target: typeof s.target === 'string' ? s.target : undefined,
      input: typeof s.input === 'string' ? s.input : undefined,
      expectedIntermediateResult:
        typeof s.expectedIntermediateResult === 'string' ? s.expectedIntermediateResult : undefined,
    }));
}

function normalizeExpectedResults(
  raw: unknown,
): Array<{
  description: string;
  verificationType: VerificationType;
  target?: string;
  verificationIntent?: VerificationIntent;
}> {
  // Handle single string result
  if (typeof raw === 'string' && raw.length > 0) {
    return [{ description: raw, verificationType: 'other' }];
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (e): e is Record<string, unknown> =>
        typeof e === 'object' && e !== null && typeof e.description === 'string',
    )
    .map((e) => {
      const verificationIntent = normalizeVerificationIntent(e.verificationIntent);
      const verificationType =
        typeof e.verificationType === 'string' && VALID_VERIFICATION_TYPES.has(e.verificationType)
          ? (e.verificationType as VerificationType)
          : verificationTypeFromIntent(verificationIntent);

      return {
        description: e.description as string,
        verificationType,
        target: typeof e.target === 'string' ? e.target : undefined,
        verificationIntent,
      };
    });
}

function verificationTypeFromIntent(intent: VerificationIntent | undefined): VerificationType {
  switch (intent?.kind) {
    case 'visible-ui-state': return 'ui';
    case 'persisted-business-state': return 'state';
    case 'api-response': return 'api';
    case 'entity-exists':
    case 'entity-absent':
    case 'value-equals':
    case 'numeric-delta': return 'state';
    default: return 'other';
  }
}

function normalizeVerificationIntent(raw: unknown) {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  const validKinds = new Set([
    'visible-ui-state',
    'persisted-business-state',
    'api-response',
    'entity-exists',
    'entity-absent',
    'value-equals',
    'numeric-delta',
    'semantic',
  ]);
  if (typeof value.kind !== 'string' || !validKinds.has(value.kind)) return undefined;
  const validAuthorities = new Set([
    'VISIBLE_UI_STATE',
    'PERSISTED_BUSINESS_STATE',
    'API_RESPONSE',
    'ENTITY_EXISTENCE',
    'ENTITY_ABSENCE',
  ]);
  const validSources = new Set(['UI', 'API', 'DATABASE']);
  return {
    kind: value.kind as 'visible-ui-state',
    subject: typeof value.subject === 'string' ? value.subject : undefined,
    property: typeof value.property === 'string' ? value.property : undefined,
    expectedValue: ['string', 'number', 'boolean'].includes(typeof value.expectedValue)
      ? (value.expectedValue as string | number | boolean)
      : undefined,
    authority:
      typeof value.authority === 'string' && validAuthorities.has(value.authority)
        ? (value.authority as 'VISIBLE_UI_STATE')
        : undefined,
    requiredSources: Array.isArray(value.requiredSources)
      ? value.requiredSources.filter(
          (source): source is 'UI' | 'API' | 'DATABASE' =>
            typeof source === 'string' && validSources.has(source),
        )
      : undefined,
  };
}

function normalizeCleanup(raw: unknown): Array<{ description: string; target?: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (c): c is Record<string, unknown> =>
        typeof c === 'object' && c !== null && typeof c.description === 'string',
    )
    .map((c) => ({
      description: c.description as string,
      target: typeof c.target === 'string' ? c.target : undefined,
    }));
}

function normalizeAutomation(raw: unknown): {
  status: AutomationStatus;
  suggestedExecutor?: SuggestedExecutor;
  reasons: string[];
} {
  if (typeof raw !== 'object' || raw === null) {
    return { status: 'unknown', reasons: ['Automation assessment not provided'] };
  }

  const r = raw as Record<string, unknown>;
  const status =
    typeof r.status === 'string' && VALID_AUTOMATION_STATUSES.has(r.status)
      ? (r.status as AutomationStatus)
      : 'unknown';

  const suggestedExecutor =
    typeof r.suggestedExecutor === 'string' && VALID_SUGGESTED_EXECUTORS.has(r.suggestedExecutor)
      ? (r.suggestedExecutor as SuggestedExecutor)
      : undefined;

  const reasons = (Array.isArray(r.reasons) ? r.reasons : []).filter(
    (reason): reason is string => typeof reason === 'string',
  );

  return { status, suggestedExecutor, reasons };
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
