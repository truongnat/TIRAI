// ---------------------------------------------------------------------------
// Deterministic data requirement extractor – no AI required
// ---------------------------------------------------------------------------
// Converts explicit test case dataNeeds, preconditions, inputs, and steps
// into DataRequirementCandidate objects without relying on AI output.
//
// This is the deterministic pre-layer described in §11-12 of the spec:
//   CODE identifies obvious data requirement candidates
//   AI enriches/classifies ambiguous cases
//
// The extractor never invents physical implementation details (DB tables,
// column names, API endpoints, selectors, credentials).
// ---------------------------------------------------------------------------

import type {
  DataRequirementCandidate,
  DataRequirementExtractionResult,
  TestCaseIRInput,
  TestDataType,
  TestDataLifecycle,
  TestDataStrategy,
  TestProvenance,
} from '../models.js';

// ---- Keyword-based type inference -----------------------------------------

const ACCOUNT_KEYWORDS = [
  'account', 'user', 'login', 'authenticated', 'credential', 'password',
  'username', 'session', 'logged in', 'sign in', 'register',
];

const DATE_KEYWORDS = [
  'date', 'time', 'timestamp', 'deadline', 'schedule', 'period',
  'duration', 'created_at', 'updated_at', 'expiry',
];

const FILE_KEYWORDS = [
  'file', 'upload', 'document', 'attachment', 'image', 'csv', 'pdf',
  'spreadsheet', 'excel',
];

const CONFIG_KEYWORDS = [
  'config', 'setting', 'parameter', 'threshold', 'limit', 'timeout',
  'max', 'min', 'policy',
];

const TOKEN_KEYWORDS = [
  'token', 'jwt', 'api key', 'apikey', 'secret', 'session id',
  'access token', 'refresh token', 'auth token',
];

const ID_KEYWORDS = [
  'id', 'uuid', 'identifier', 'reference number', 'code', 'serial',
  'generated id', 'unique id',
];

const STATE_KEYWORDS = [
  'state', 'status', 'flag', 'mode', 'phase', 'stage', 'condition',
  'active', 'inactive', 'enabled', 'disabled', 'pending', 'approved',
  'rejected', 'completed',
];

const DB_STATE_KEYWORDS = [
  'record', 'entry', 'row', 'existing', 'database', 'table',
  'must exist', 'already exists', 'previously created',
];

// ---- Classification helpers -----------------------------------------------

function classifyType(description: string, inputDescription?: string): TestDataType {
  const text = `${description} ${inputDescription ?? ''}`.toLowerCase();

  if (ACCOUNT_KEYWORDS.some((k) => text.includes(k))) return 'account';
  if (TOKEN_KEYWORDS.some((k) => text.includes(k))) return 'token';
  if (DATE_KEYWORDS.some((k) => text.includes(k))) return 'input';
  if (FILE_KEYWORDS.some((k) => text.includes(k))) return 'file';
  if (CONFIG_KEYWORDS.some((k) => text.includes(k))) return 'configuration';
  if (ID_KEYWORDS.some((k) => text.includes(k))) return 'identifier';
  if (DB_STATE_KEYWORDS.some((k) => text.includes(k))) return 'database-record';
  if (STATE_KEYWORDS.some((k) => text.includes(k))) return 'state';

  return 'other';
}

function classifyLifecycle(description: string, type: TestDataType): TestDataLifecycle {
  const text = description.toLowerCase();

  if (text.includes('existing') || text.includes('already') || text.includes('previously')) {
    return 'existing';
  }
  if (text.includes('new') || text.includes('create') || text.includes('generate')) {
    return 'temporary';
  }
  if (type === 'account' || type === 'database-record') {
    return 'existing';
  }
  if (type === 'token' || type === 'identifier') {
    return 'generated';
  }
  return 'unknown';
}

function classifyStrategy(description: string, type: TestDataType): TestDataStrategy {
  const text = description.toLowerCase();

  if (text.includes('invalid') || text.includes('wrong') || text.includes('incorrect')) {
    return 'generate';
  }
  if (text.includes('existing') || text.includes('already')) {
    return 'reuse-existing';
  }
  if (type === 'account' || type === 'database-record') {
    return 'reuse-existing';
  }
  if (type === 'token' || type === 'identifier') {
    return 'generate';
  }
  if (type === 'input') {
    return 'generate';
  }
  return 'unknown';
}

// ---- Deterministic extraction from dataNeeds ------------------------------

function extractFromDataNeeds(
  testCases: TestCaseIRInput['testCases'],
): DataRequirementCandidate[] {
  const candidates: DataRequirementCandidate[] = [];
  let counter = 0;
  // Track temporaryId by dedup key so identical data needs share the same ID
  const keyToTempId = new Map<string, string>();

  for (const tc of testCases) {
    for (const dn of tc.dataNeeds) {
      if (!dn.description || !dn.description.trim()) continue;

      const type = classifyType(dn.description);
      const lifecycle = classifyLifecycle(dn.description, type);
      const strategy = classifyStrategy(dn.description, type);

      // Use same temporaryId for identical data needs (enables cross-TC dedup)
      const dedupKey = `${type}::${dn.description.toLowerCase().trim()}`;
      let temporaryId = keyToTempId.get(dedupKey);
      if (!temporaryId) {
        counter++;
        temporaryId = `DET-DATA-${String(counter).padStart(4, '0')}`;
        keyToTempId.set(dedupKey, temporaryId);
      }

      const provenance: TestProvenance[] = [];
      if (Array.isArray(dn.relatedRequirementIds)) {
        for (const reqId of dn.relatedRequirementIds) {
          if (typeof reqId === 'string' && reqId) {
            provenance.push({ requirementId: reqId });
          }
        }
      }

      // Also inherit TC provenance
      if (Array.isArray(tc.provenance)) {
        for (const p of tc.provenance) {
          if (typeof p.requirementId === 'string' && p.requirementId) {
            const alreadyHas = provenance.some((pp) => pp.requirementId === p.requirementId);
            if (!alreadyHas) {
              provenance.push({
                requirementId: p.requirementId,
                contextId: p.contextId,
                sheet: p.sheet,
                ranges: p.ranges,
              });
            }
          }
        }
      }

      candidates.push({
        temporaryId,
        testCaseId: tc.id,
        name: dn.description.length > 80 ? `${dn.description.slice(0, 77)}...` : dn.description,
        description: dn.description,
        type,
        lifecycle,
        strategy,
        constraints: Array.isArray(dn.constraints)
          ? dn.constraints.map((c) => ({ type: 'other' as const, description: typeof c === 'string' ? c : String(c) }))
          : [],
        relatedRequirementIds: Array.isArray(dn.relatedRequirementIds) ? dn.relatedRequirementIds : [],
        relatedEntityIds: Array.isArray(dn.relatedEntityIds) ? dn.relatedEntityIds : [],
        provenance,
        confidence: 0.9,
      });
    }
  }

  return candidates;
}

// ---- Deterministic extraction from preconditions/inputs/steps -------------

function extractFromContext(
  testCases: TestCaseIRInput['testCases'],
  existingCandidateKeys: Set<string>,
): DataRequirementCandidate[] {
  const candidates: DataRequirementCandidate[] = [];
  let counter = 0;

  for (const tc of testCases) {
    // Only extract from TCs that have NO explicit dataNeeds
    if (tc.dataNeeds.length > 0) continue;

    const contextItems: Array<{ description: string; source: string }> = [];

    // Scan preconditions for data indicators
    for (const p of tc.preconditions) {
      const text = p.description.toLowerCase();
      const isUIState = text.includes('is displayed') || text.includes('is shown') ||
        text.includes('is visible') || text.includes('is rendered') ||
        text.includes('screen is') || text.includes('page is') ||
        text.includes('form is') || text.includes('button is');
      if (isUIState) continue;
      if (ACCOUNT_KEYWORDS.some((k) => text.includes(k)) ||
          DB_STATE_KEYWORDS.some((k) => text.includes(k)) ||
          STATE_KEYWORDS.some((k) => text.includes(k)) ||
          text.includes('must') || text.includes('has') || text.includes('exists')) {
        contextItems.push({ description: p.description, source: 'precondition' });
      }
    }

    // Scan inputs for data indicators
    for (const inp of tc.inputs) {
      if (inp.name && inp.valueStrategy) {
        contextItems.push({
          description: `${inp.name} (${inp.valueStrategy})${inp.description ? `: ${inp.description}` : ''}`,
          source: 'input',
        });
      }
    }

    // Scan steps for data indicators
    for (const step of tc.steps) {
      const text = `${step.action} ${step.input ?? ''}`.toLowerCase();
      const actionText = step.action.toLowerCase();
      const isVerification = actionText.startsWith('observe') || actionText.startsWith('verify') ||
        actionText.startsWith('check') || actionText.startsWith('confirm') ||
        actionText.startsWith('ensure') || actionText.startsWith('assert');
      if (isVerification) continue;
      if (DATE_KEYWORDS.some((k) => text.includes(k)) ||
          FILE_KEYWORDS.some((k) => text.includes(k)) ||
          text.includes('enter') || text.includes('select') || text.includes('provide') ||
          text.includes('input') || text.includes('type')) {
        contextItems.push({
          description: step.action,
          source: 'step',
        });
      }
    }

    for (const item of contextItems) {
      counter++;
      const type = classifyType(item.description);
      const lifecycle = classifyLifecycle(item.description, type);
      const strategy = classifyStrategy(item.description, type);

      // Dedup key: same as deduplicator uses
      const dedupKey = `${type}::${item.description.toLowerCase().trim()}::`;
      if (existingCandidateKeys.has(dedupKey)) continue;
      existingCandidateKeys.add(dedupKey);

      const provenance: TestProvenance[] = [];
      if (Array.isArray(tc.provenance)) {
        for (const p of tc.provenance) {
          if (typeof p.requirementId === 'string' && p.requirementId) {
            provenance.push({
              requirementId: p.requirementId,
              contextId: p.contextId,
              sheet: p.sheet,
              ranges: p.ranges,
            });
          }
        }
      }

      candidates.push({
        temporaryId: `DET-CTX-${String(counter).padStart(4, '0')}`,
        testCaseId: tc.id,
        name: item.description.length > 80 ? `${item.description.slice(0, 77)}...` : item.description,
        description: item.description,
        type,
        lifecycle,
        strategy,
        constraints: [],
        relatedRequirementIds: tc.requirementIds ?? [],
        relatedEntityIds: [],
        provenance,
        confidence: 0.7,
      });
    }
  }

  return candidates;
}

// ---- Public API -----------------------------------------------------------

/**
 * Deterministically extract data requirement candidates from test case IR.
 *
 * This function never calls AI. It converts explicit dataNeeds into
 * DataRequirementCandidate objects. Test cases with empty dataNeeds
 * are left for AI enrichment.
 *
 * Returns a DataRequirementExtractionResult that can be merged with AI results.
 */
export function extractDeterministic(
  testCases: TestCaseIRInput['testCases'],
): DataRequirementExtractionResult {
  const dataNeedCandidates = extractFromDataNeeds(testCases);

  const existingKeys = new Set<string>();
  for (const c of dataNeedCandidates) {
    existingKeys.add(`${c.type}::${c.description.toLowerCase().trim()}::`);
  }
  const contextCandidates = extractFromContext(testCases, existingKeys);

  return {
    dataCandidates: [...dataNeedCandidates, ...contextCandidates],
    unresolvedCandidates: [],
  };
}

/**
 * Merge deterministic and AI extraction results.
 * Deterministic candidates take precedence (they are ground truth from IR).
 * AI candidates that duplicate deterministic ones are dropped.
 */
export function mergeExtractionResults(
  deterministic: DataRequirementExtractionResult,
  ai: DataRequirementExtractionResult,
): DataRequirementExtractionResult {
  // Build a key set from deterministic candidates
  const detKeys = new Set<string>();
  for (const c of deterministic.dataCandidates) {
    detKeys.add(`${c.type}::${c.description.toLowerCase().trim()}::${c.testCaseId}`);
  }

  // Filter AI candidates: keep only those not already covered by deterministic
  const newAICandidates = ai.dataCandidates.filter((c) => {
    const key = `${c.type}::${c.description.toLowerCase().trim()}::${c.testCaseId}`;
    return !detKeys.has(key);
  });

  // Merge unresolved (union, no dedup needed)
  const allUnresolved = [
    ...deterministic.unresolvedCandidates,
    ...ai.unresolvedCandidates,
  ];

  return {
    dataCandidates: [...deterministic.dataCandidates, ...newAICandidates],
    unresolvedCandidates: allUnresolved,
  };
}
