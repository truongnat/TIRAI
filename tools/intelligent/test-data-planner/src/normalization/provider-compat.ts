// ---------------------------------------------------------------------------
// Provider compatibility adapter — isolates all legacy key aliases
// ---------------------------------------------------------------------------
// DeepSeek (and potentially other providers) return structurally equivalent
// but nominally different JSON keys.  This module maps every observed alias
// to the canonical envelope shape.  Domain code MUST consume only canonical
// keys after this adapter has run.
//
// Provider aliases are intentionally limited to shapes captured from real
// responses.  Unknown structures must fail rather than expand compatibility
// heuristically.
//
// Observed aliases (all from captured DeepSeek responses):
//   Root:       dataRequirements, data_candidates, data_items
//   TC ID:      tracedTo, traced_to, sourceTestCaseIds, source_test_case_ids,
//               traceability, test_case_id
//   Temp ID:    temporary_id
//   Enum alt:   data_type, data_lifecycle, data_strategy
//   Req IDs:    related_requirement_ids
//   Ent IDs:    related_entity_ids
//   Unresolved: test_case_ids (same alias set as TC ID)
//   Dep source: source_temporary_id, source, from
//   Dep target: target_temporary_id, target, to
//   Reuse:      reuse_candidates, reuse_opportunities, reuseSets
//   Reuse pol:  reuse_policy
//   Constraint: string values (wrapped to { type: 'other', description })
// ---------------------------------------------------------------------------

import type {
  DataConstraintType,
  DataDependencyType,
  DataRequirementExtractionResult,
  DataRequirementCandidate,
  DependencyAnalysisResult,
  DependencyCandidate,
  ReuseCandidate,
  ReusePolicy,
  TestDataLifecycle,
  TestDataStrategy,
  TestDataType,
  TestProvenance,
  DataUnresolvedReason,
} from '../models.js';

// ---- Valid enum sets ------------------------------------------------------

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

const VALID_DEP_TYPES: ReadonlySet<string> = new Set([
  'requires', 'references', 'derived-from', 'created-after',
  'must-exist-before', 'cleanup-after', 'other',
]);

const VALID_REUSE_POLICIES: ReadonlySet<string> = new Set([
  'safe', 'isolated-copy', 'read-only', 'unknown',
]);

const VALID_UNRESOLVED_REASONS: ReadonlySet<string> = new Set([
  'missing-constraint', 'missing-source', 'unknown-state',
  'unknown-data-location', 'unknown-creation-strategy',
  'ambiguous-dependency', 'other',
]);

const DEFAULT_CONFIDENCE = 0.7;

// ---- Shared helpers -------------------------------------------------------

function pickEnum(value: unknown, valid: ReadonlySet<string>, fallback: string): string {
  if (typeof value === 'string' && valid.has(value)) return value;
  return fallback;
}

function pickString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function pickStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

/**
 * Resolve a tracedTo-style array to a single valid test case ID.
 * Returns the first valid TC ID found, or empty string.
 */
function resolveFirstValidTCId(value: unknown, validTCIds: Set<string>): string {
  if (!Array.isArray(value)) return '';
  for (const id of value) {
    if (typeof id === 'string' && validTCIds.has(id)) return id;
  }
  return '';
}

function normalizeProvenanceValue(raw: unknown): TestProvenance[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is Record<string, unknown> =>
      typeof p === 'object' && p !== null && typeof p.requirementId === 'string',
    )
    .map((p) => ({
      requirementId: p.requirementId as string,
      contextId: typeof p.contextId === 'string' ? p.contextId : undefined,
      sheet: typeof p.sheet === 'string' ? p.sheet : undefined,
      ranges: Array.isArray(p.ranges)
        ? p.ranges.filter((x): x is string => typeof x === 'string')
        : undefined,
    }));
}

// ---- Data requirement adapter ---------------------------------------------

/**
 * Adapt a raw provider response into the canonical data requirement shape.
 * All known DeepSeek aliases are resolved here.
 * Unknown root keys are silently ignored (they will not produce candidates).
 */
export function adaptDataRequirementRaw(
  raw: Record<string, unknown>,
  validTCIds: Set<string>,
): DataRequirementExtractionResult {
  // --- Resolve root key for data candidates ---
  const rawCandidates = resolveDataCandidateArray(raw);
  const dataCandidates: DataRequirementCandidate[] = [];

  for (const c of rawCandidates) {
    if (typeof c !== 'object' || c === null) continue;
    const obj = c as Record<string, unknown>;

    // Resolve test case ID from known aliases
    const tcId = resolveTestCaseId(obj, validTCIds);
    if (!tcId) continue;

    // Resolve temporary ID
    const temporaryId = pickString(obj.temporaryId ?? obj.temporary_id)
      || `TMP-DATA-${String(dataCandidates.length + 1).padStart(4, '0')}`;

    const name = pickString(obj.name) || pickString(obj.description);
    const description = pickString(obj.description);

    const type = pickEnum(obj.type ?? obj.data_type, VALID_TYPES, 'other') as TestDataType;
    const lifecycle = pickEnum(obj.lifecycle ?? obj.data_lifecycle, VALID_LIFECYCLES, 'unknown') as TestDataLifecycle;
    const strategy = pickEnum(obj.strategy ?? obj.data_strategy, VALID_STRATEGIES, 'unknown') as TestDataStrategy;

    const constraints = adaptConstraints(obj.constraints);
    const relatedRequirementIds = pickStringArray(obj.relatedRequirementIds ?? obj.related_requirement_ids);
    const relatedEntityIds = pickStringArray(obj.relatedEntityIds ?? obj.related_entity_ids);
    const provenance = normalizeProvenanceValue(obj.provenance);
    const confidence = typeof obj.confidence === 'number' ? obj.confidence : DEFAULT_CONFIDENCE;

    dataCandidates.push({
      temporaryId, testCaseId: tcId, name, description, type, lifecycle, strategy,
      constraints, relatedRequirementIds, relatedEntityIds, provenance, confidence,
    });
  }

  // --- Resolve root key for unresolved candidates ---
  const rawUnresolved = resolveUnresolvedArray(raw);
  const unresolvedCandidates: Array<{
    testCaseIds: string[];
    description: string;
    reason: DataUnresolvedReason;
    provenance: TestProvenance[];
  }> = [];

  for (const u of rawUnresolved) {
    if (typeof u !== 'object' || u === null) continue;
    const obj = u as Record<string, unknown>;

    const testCaseIds = resolveTestCaseIdArray(obj, validTCIds);
    if (testCaseIds.length === 0) continue;

    const description = pickString(obj.description);
    if (!description) continue;

    const reason = pickEnum(obj.reason, VALID_UNRESOLVED_REASONS, 'other') as DataUnresolvedReason;
    const provenance = normalizeProvenanceValue(obj.provenance);

    unresolvedCandidates.push({ testCaseIds, description, reason, provenance });
  }

  return { dataCandidates, unresolvedCandidates };
}

/** Resolve the data candidate array from any known root key. */
function resolveDataCandidateArray(raw: Record<string, unknown>): Array<Record<string, unknown>> {
  if (Array.isArray(raw.dataCandidates)) return raw.dataCandidates as Array<Record<string, unknown>>;
  if (Array.isArray(raw.dataRequirements)) return raw.dataRequirements as Array<Record<string, unknown>>;
  if (Array.isArray(raw.data_candidates)) return raw.data_candidates as Array<Record<string, unknown>>;
  if (Array.isArray(raw.data_items)) return raw.data_items as Array<Record<string, unknown>>;
  return [];
}

/** Resolve the unresolved candidate array from any known root key. */
function resolveUnresolvedArray(raw: Record<string, unknown>): Array<Record<string, unknown>> {
  if (Array.isArray(raw.unresolvedCandidates)) return raw.unresolvedCandidates as Array<Record<string, unknown>>;
  if (Array.isArray(raw.unresolved_candidates)) return raw.unresolved_candidates as Array<Record<string, unknown>>;
  return [];
}

/**
 * Resolve a single test case ID from known aliases.
 * Priority: testCaseId > test_case_id > tracedTo variants.
 */
function resolveTestCaseId(obj: Record<string, unknown>, validTCIds: Set<string>): string {
  // Direct string fields
  const direct = pickString(obj.testCaseId) || pickString(obj.test_case_id);
  if (direct && validTCIds.has(direct)) return direct;

  // Array-style aliases: tracedTo, traced_to, sourceTestCaseIds, etc.
  const arrValue = obj.tracedTo ?? obj.traced_to ?? obj.sourceTestCaseIds
    ?? obj.source_test_case_ids ?? obj.traceability;
  return resolveFirstValidTCId(arrValue, validTCIds);
}

/**
 * Resolve test case IDs array for unresolved items.
 * Same alias set as single TC ID resolution.
 */
function resolveTestCaseIdArray(obj: Record<string, unknown>, validTCIds: Set<string>): string[] {
  // Direct array fields
  const direct = obj.testCaseIds ?? obj.test_case_ids;
  if (Array.isArray(direct)) {
    return pickStringArray(direct).filter((id) => validTCIds.has(id));
  }

  // Aliased array fields
  const aliased = obj.tracedTo ?? obj.traced_to ?? obj.sourceTestCaseIds
    ?? obj.source_test_case_ids ?? obj.traceability;
  if (Array.isArray(aliased)) {
    return pickStringArray(aliased).filter((id) => validTCIds.has(id));
  }

  return [];
}

/**
 * Adapt constraints from raw provider format.
 * Handles both object constraints and plain string constraints.
 */
function adaptConstraints(raw: unknown): Array<{
  type: DataConstraintType;
  field?: string;
  operator?: string;
  value?: unknown;
  description: string;
}> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> | string =>
      (typeof c === 'object' && c !== null) || typeof c === 'string',
    )
    .map((c) => {
      if (typeof c === 'string') {
        return { type: 'other' as DataConstraintType, description: c };
      }
      return {
        type: pickEnum(c.type, VALID_CONSTRAINT_TYPES, 'other') as DataConstraintType,
        field: typeof c.field === 'string' ? c.field : undefined,
        operator: typeof c.operator === 'string' ? c.operator : undefined,
        value: c.value,
        description: typeof c.description === 'string' ? c.description : '',
      };
    });
}

// ---- Dependency adapter ---------------------------------------------------

/**
 * Adapt a raw provider response into the canonical dependency analysis shape.
 */
export function adaptDependencyRaw(
  raw: Record<string, unknown>,
  validTempIds: Set<string>,
): DependencyAnalysisResult {
  // --- Resolve dependency candidates ---
  const rawDeps = resolveDependencyArray(raw);
  const dependencyCandidates: DependencyCandidate[] = [];

  for (const d of rawDeps) {
    if (typeof d !== 'object' || d === null) continue;
    const obj = d as Record<string, unknown>;

    const source = resolveDepEndpoint(obj, 'source');
    const target = resolveDepEndpoint(obj, 'target');
    if (!source || !target) continue;
    if (!validTempIds.has(source) || !validTempIds.has(target)) continue;

    const type = (pickEnum(obj.type, VALID_DEP_TYPES, 'other')) as DataDependencyType;
    const description = typeof obj.description === 'string' ? obj.description : undefined;

    dependencyCandidates.push({ sourceTemporaryId: source, targetTemporaryId: target, type, description });
  }

  // --- Resolve reuse candidates ---
  const rawReuse = resolveReuseArray(raw);
  const reuseCandidates: ReuseCandidate[] = [];

  for (const r of rawReuse) {
    if (typeof r !== 'object' || r === null) continue;
    const obj = r as Record<string, unknown>;

    const ids = pickStringArray(obj.temporaryIds).filter((v) => validTempIds.has(v));
    if (ids.length < 2) continue;

    const reason = pickString(obj.reason);
    const reusePolicy = (pickEnum(obj.reusePolicy ?? obj.reuse_policy, VALID_REUSE_POLICIES, 'unknown')) as ReusePolicy;

    reuseCandidates.push({ temporaryIds: ids, reason, reusePolicy });
  }

  return { dependencyCandidates, reuseCandidates };
}

/** Resolve the dependency array from any known root key. */
function resolveDependencyArray(raw: Record<string, unknown>): Array<Record<string, unknown>> {
  if (Array.isArray(raw.dependencyCandidates)) return raw.dependencyCandidates as Array<Record<string, unknown>>;
  if (Array.isArray(raw.dependency_candidates)) return raw.dependency_candidates as Array<Record<string, unknown>>;
  if (Array.isArray(raw.dependencies)) return raw.dependencies as Array<Record<string, unknown>>;
  return [];
}

/** Resolve the reuse array from any known root key. */
function resolveReuseArray(raw: Record<string, unknown>): Array<Record<string, unknown>> {
  if (Array.isArray(raw.reuseCandidates)) return raw.reuseCandidates as Array<Record<string, unknown>>;
  if (Array.isArray(raw.reuse_candidates)) return raw.reuse_candidates as Array<Record<string, unknown>>;
  if (Array.isArray(raw.reuse_opportunities)) return raw.reuse_opportunities as Array<Record<string, unknown>>;
  if (Array.isArray(raw.reuseSets)) return raw.reuseSets as Array<Record<string, unknown>>;
  return [];
}

/**
 * Resolve a dependency endpoint (source or target) from known aliases.
 */
function resolveDepEndpoint(obj: Record<string, unknown>, role: 'source' | 'target'): string {
  if (role === 'source') {
    return pickString(obj.sourceTemporaryId)
      || pickString(obj.source_temporary_id)
      || pickString(obj.source)
      || pickString(obj.from);
  }
  return pickString(obj.targetTemporaryId)
    || pickString(obj.target_temporary_id)
    || pickString(obj.target)
    || pickString(obj.to);
}
