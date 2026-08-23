// ---------------------------------------------------------------------------
// Data requirement extractor – AI-driven data requirement extraction
// ---------------------------------------------------------------------------

import type { AIProvider, JSONSchema } from 'ai-provider';
import type {
  DataRequirementExtractionResult,
  DataRequirementCandidate,
  TestCaseIRInput,
  TestDataPlannerWarning,
  TestDataType,
  TestDataLifecycle,
  TestDataStrategy,
  DataConstraintType,
  DataUnresolvedReason,
  TestProvenance,
} from '../models.js';
import { TestDataPlannerError, TestDataPlannerErrorCode } from '../errors.js';
import { TestDataPlannerWarningCode } from '../warnings.js';
import { TEST_DATA_PLANNER_SYSTEM_PROMPT } from '../prompts/system.js';
import { buildDataRequirementPrompt } from '../prompts/data-requirement.js';
import { buildDataRepairPrompt } from '../prompts/repair.js';
import { dataRequirementExtractionSchema } from '../schemas/data-schemas.js';

const DEFAULT_MAX_REPAIR_ATTEMPTS = 1;
const DEFAULT_CONFIDENCE = 0.7;

const VALID_TYPES: ReadonlySet<string> = new Set([
  'input', 'database-record', 'account', 'state', 'external-response',
  'file', 'configuration', 'token', 'identifier', 'reference-data', 'other',
]);

const VALID_LIFECYCLES: ReadonlySet<string> = new Set([
  'existing', 'temporary', 'generated', 'shared', 'persistent', 'unknown',
]);

const VALID_STRATEGIES: ReadonlySet<string> = new Set([
  'reuse-existing', 'create-new', 'generate', 'derive', 'mock', 'stub',
  'configure', 'select-existing', 'unknown',
]);

const VALID_CONSTRAINT_TYPES: ReadonlySet<string> = new Set([
  'required', 'format', 'min', 'max', 'length', 'unique', 'nullable',
  'foreign-key', 'state', 'value', 'relation', 'other',
]);

const VALID_UNRESOLVED_REASONS: ReadonlySet<string> = new Set([
  'missing-constraint', 'missing-source', 'unknown-state',
  'unknown-data-location', 'unknown-creation-strategy',
  'ambiguous-dependency', 'other',
]);

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

      const result = normalizeDataRequirementResult(response.data, validTCIds);

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

// ---- Normalization --------------------------------------------------------

export function normalizeDataRequirementResult(
  raw: Record<string, unknown>,
  validTCIds: Set<string>,
): DataRequirementExtractionResult {
  const rawCandidates = (Array.isArray(raw.dataCandidates) ? raw.dataCandidates : []) as Array<Record<string, unknown>>;

  // Handle legacy alias "dataRequirements"
  if (rawCandidates.length === 0 && Array.isArray(raw.dataRequirements)) {
    const legacy = raw.dataRequirements as Array<Record<string, unknown>>;
    rawCandidates.push(...legacy);
  }

  // Handle legacy alias "data_candidates"
  if (rawCandidates.length === 0 && Array.isArray(raw.data_candidates)) {
    const legacy = raw.data_candidates as Array<Record<string, unknown>>;
    rawCandidates.push(...legacy);
  }

  // Handle legacy alias "data_items"
  if (rawCandidates.length === 0 && Array.isArray(raw.data_items)) {
    const legacy = raw.data_items as Array<Record<string, unknown>>;
    rawCandidates.push(...legacy);
  }

  const dataCandidates: DataRequirementCandidate[] = [];
  for (const c of rawCandidates) {
    const tcId = typeof c.testCaseId === 'string' ? c.testCaseId
      : typeof c.test_case_id === 'string' ? c.test_case_id
      : resolveTracedTo(
          c.tracedTo ?? c.traced_to ?? c.sourceTestCaseIds ?? c.source_test_case_ids ?? c.traceability,
          validTCIds,
        );
    if (!tcId || !validTCIds.has(tcId)) continue;

    const temporaryId = typeof c.temporaryId === 'string' ? c.temporaryId
      : typeof c.temporary_id === 'string' ? c.temporary_id
      : `TMP-DATA-${String(dataCandidates.length + 1).padStart(4, '0')}`;

    const name = typeof c.name === 'string' ? c.name : (typeof c.description === 'string' ? c.description : '');
    const description = typeof c.description === 'string' ? c.description : '';

    const type = normalizeEnum(c.type ?? c.data_type, VALID_TYPES, 'other') as TestDataType;
    const lifecycle = normalizeEnum(c.lifecycle ?? c.data_lifecycle, VALID_LIFECYCLES, 'unknown') as TestDataLifecycle;
    const strategy = normalizeEnum(c.strategy ?? c.data_strategy, VALID_STRATEGIES, 'unknown') as TestDataStrategy;

    const constraints = normalizeConstraints(c.constraints);
    const relatedRequirementIds = normalizeStringArray(c.relatedRequirementIds ?? c.related_requirement_ids);
    const relatedEntityIds = normalizeStringArray(c.relatedEntityIds ?? c.related_entity_ids);
    const provenance = normalizeProvenance(c.provenance);
    const confidence = typeof c.confidence === 'number' ? c.confidence : DEFAULT_CONFIDENCE;

    dataCandidates.push({
      temporaryId, testCaseId: tcId, name, description, type, lifecycle, strategy,
      constraints, relatedRequirementIds, relatedEntityIds, provenance, confidence,
    });
  }

  const rawUnresolved = (Array.isArray(raw.unresolvedCandidates) ? raw.unresolvedCandidates : []) as Array<Record<string, unknown>>;
  const unresolvedCandidates = [];
  for (const u of rawUnresolved) {
    const testCaseIds = normalizeStringArray(
      u.testCaseIds ?? u.test_case_ids ?? u.tracedTo ?? u.traced_to ?? u.sourceTestCaseIds ?? u.source_test_case_ids ?? u.traceability,
    ).filter((id) => validTCIds.has(id));
    if (testCaseIds.length === 0) continue;

    const description = typeof u.description === 'string' ? u.description : '';
    if (!description) continue;

    const reason = normalizeEnum(u.reason, VALID_UNRESOLVED_REASONS, 'other') as DataUnresolvedReason;
    const provenance = normalizeProvenance(u.provenance);

    unresolvedCandidates.push({ testCaseIds, description, reason, provenance });
  }

  return { dataCandidates, unresolvedCandidates };
}

// ---- Helpers --------------------------------------------------------------

/**
 * Resolve a tracedTo array to a single valid test case ID.
 * Returns the first valid TC ID from the array, or empty string.
 */
function resolveTracedTo(value: unknown, validTCIds: Set<string>): string {
  if (!Array.isArray(value)) return '';
  for (const id of value) {
    if (typeof id === 'string' && validTCIds.has(id)) return id;
  }
  return '';
}

function normalizeEnum(value: unknown, valid: ReadonlySet<string>, fallback: string): string {
  if (typeof value === 'string' && valid.has(value)) return value;
  return fallback;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function normalizeConstraints(raw: unknown): Array<{
  type: DataConstraintType; field?: string; operator?: string;
  value?: unknown; description: string;
}> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> | string =>
      (typeof c === 'object' && c !== null) || typeof c === 'string',
    )
    .map((c) => {
      // Handle string constraints (e.g. "Must be unique")
      if (typeof c === 'string') {
        return { type: 'other' as DataConstraintType, description: c };
      }
      return {
        type: normalizeEnum(c.type, VALID_CONSTRAINT_TYPES, 'other') as DataConstraintType,
        field: typeof c.field === 'string' ? c.field : undefined,
        operator: typeof c.operator === 'string' ? c.operator : undefined,
        value: c.value,
        description: typeof c.description === 'string' ? c.description : '',
      };
    });
}

function normalizeProvenance(raw: unknown): TestProvenance[] {
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
