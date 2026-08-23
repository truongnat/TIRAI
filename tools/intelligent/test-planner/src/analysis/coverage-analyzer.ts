// ---------------------------------------------------------------------------
// Coverage analyzer – AI-driven coverage analysis
// ---------------------------------------------------------------------------
// Sends requirement batches to the AI provider for coverage strategy
// determination.  Includes normalization and repair support.

import type { AIProvider, JSONSchema } from 'ai-provider';
import type {
  CoverageAnalysisResult,
  CoverageCandidate,
  CoverageStrategy,
  RequirementIRInput,
  TestPlannerWarning,
  TestProvenance,
  UnresolvedReason,
} from '../models.js';
import { TestPlannerError, TestPlannerErrorCode } from '../errors.js';
import { TestPlannerWarningCode } from '../warnings.js';
import { TEST_PLANNER_SYSTEM_PROMPT } from '../prompts/system.js';
import { buildCoveragePrompt } from '../prompts/coverage.js';
import { buildRepairPrompt } from '../prompts/repair.js';
import { coverageAnalysisSchema } from '../schemas/test-schemas.js';

/** Maximum number of schema-level repair attempts per batch. */
const DEFAULT_MAX_REPAIR_ATTEMPTS = 1;

/** Default confidence when AI omits the value. */
const DEFAULT_CONFIDENCE = 0.7;

const VALID_STRATEGIES: ReadonlySet<string> = new Set([
  'positive', 'negative', 'boundary', 'validation', 'state-transition',
  'error-handling', 'interface', 'data', 'security', 'other',
]);

const VALID_UNRESOLVED_REASONS: ReadonlySet<string> = new Set([
  'missing-expected-result', 'missing-input-constraint', 'missing-error-behavior',
  'ambiguous-requirement', 'not-testable', 'other',
]);

/** Lenient schema for json_object mode. */
const lenientObjectSchema: JSONSchema = {
  type: 'object',
  properties: {},
  additionalProperties: true,
};

/**
 * Analyze coverage for a batch of requirements.
 */
export async function analyzeCoverage(
  requirements: RequirementIRInput['requirements'],
  provider: AIProvider,
  maxRepairAttempts: number = DEFAULT_MAX_REPAIR_ATTEMPTS,
): Promise<{
  result: CoverageAnalysisResult;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  warnings?: TestPlannerWarning[];
}> {
  const systemPrompt = TEST_PLANNER_SYSTEM_PROMPT;
  const userPrompt = buildCoveragePrompt(requirements);
  const warnings: TestPlannerWarning[] = [];

  const validReqIds = new Set(requirements.map((r) => r.id));

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
              coverageAnalysisSchema,
            ) },
          ];

      const response = await provider.generate<Record<string, unknown>>({
        messages,
        responseSchema: lenientObjectSchema,
        temperature: 0,
      });

      const result = normalizeCoverageResult(response.data, validReqIds);

      if (attempt > 0) {
        warnings.push({
          code: TestPlannerWarningCode.REPAIR_APPLIED,
          message: `Coverage schema repair succeeded on attempt ${attempt}`,
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
    `Coverage analysis failed after ${maxRepairAttempts + 1} attempt(s): ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    lastError,
  );
}

// ---- Normalization --------------------------------------------------------

// Legacy aliases are intentionally limited to formats captured from real
// provider responses. Unknown shapes must fail validation rather than expand
// the compatibility surface silently.

export function normalizeCoverageResult(
  raw: Record<string, unknown>,
  validReqIds: Set<string>,
): CoverageAnalysisResult {
  let rawCoverage = (Array.isArray(raw.coverageCandidates) ? raw.coverageCandidates : []) as Array<Record<string, unknown>>;

  // Handle alternative key "coverage" used by some AI responses
  if (rawCoverage.length === 0 && Array.isArray(raw.coverage)) {
    rawCoverage = raw.coverage as Array<Record<string, unknown>>;
  }

  // Handle DeepSeek format: { "requirements": [{ "id": "REQ-0001", "strategies": [...] }] }
  if (rawCoverage.length === 0 && Array.isArray(raw.requirements)) {
    const reqs = raw.requirements as Array<Record<string, unknown>>;
    const flatCandidates: Array<Record<string, unknown>> = [];
    for (const req of reqs) {
      const id = typeof req.id === 'string' ? req.id : '';
      if (!id || !validReqIds.has(id)) continue;
      // Handle various strategy field names (camelCase and snake_case)
      const strategies = Array.isArray(req.strategies) ? req.strategies 
        : Array.isArray(req.justifiedStrategies) ? req.justifiedStrategies 
        : Array.isArray(req.justified_strategies) ? req.justified_strategies 
        : Array.isArray(req.selected_strategies) ? req.selected_strategies 
        : Array.isArray(req.supported_strategies) ? req.supported_strategies 
        : [];
      if (strategies.length > 0) {
        flatCandidates.push({
          requirementId: id,
          strategies: (strategies as unknown[]).filter((s): s is string => typeof s === 'string'),
          reasons: Array.isArray(req.reasons) ? (req.reasons as unknown[]).filter((r): r is string => typeof r === 'string') : [],
          confidence: typeof req.confidence === 'number' ? req.confidence : DEFAULT_CONFIDENCE,
        });
      }
    }
    if (flatCandidates.length > 0) rawCoverage = flatCandidates;
  }

  // Handle DeepSeek format: { "coverage_analysis": { "REQ-0001": { "strategies": [...] } } }
  // Also handles: { "coverage_analysis": [{ "id": "REQ-0001", "strategies": [...] }] }
  if (rawCoverage.length === 0 && raw.coverage_analysis !== undefined) {
    const analysis = raw.coverage_analysis;
    const flatCandidates: Array<Record<string, unknown>> = [];
    
    // Handle array format: { "coverage_analysis": [...] }
    if (Array.isArray(analysis)) {
      for (const item of analysis) {
        if (typeof item !== 'object' || item === null) continue;
        const obj = item as Record<string, unknown>;
        const id = typeof obj.id === 'string' ? obj.id : '';
        if (!id || !validReqIds.has(id)) continue;
        // Handle various strategy field names (camelCase and snake_case)
        const strategies = Array.isArray(obj.strategies) ? obj.strategies 
          : Array.isArray(obj.justifiedStrategies) ? obj.justifiedStrategies 
          : Array.isArray(obj.justified_strategies) ? obj.justified_strategies 
          : Array.isArray(obj.selected_strategies) ? obj.selected_strategies 
          : [];
        if (strategies.length > 0) {
          flatCandidates.push({
            requirementId: id,
            strategies: (strategies as unknown[]).filter((s): s is string => typeof s === 'string'),
            reasons: Array.isArray(obj.reasons) ? (obj.reasons as unknown[]).filter((r): r is string => typeof r === 'string') : [],
            confidence: typeof obj.confidence === 'number' ? obj.confidence : DEFAULT_CONFIDENCE,
          });
        }
      }
    }
    // Handle object format: { "coverage_analysis": { "REQ-0001": { "strategies": [...] } } }
    else if (typeof analysis === 'object' && analysis !== null) {
      const analysisObj = analysis as Record<string, unknown>;
      for (const [key, value] of Object.entries(analysisObj)) {
        if (!validReqIds.has(key)) continue;
        if (typeof value === 'object' && value !== null) {
          const obj = value as Record<string, unknown>;
          // Handle various strategy field names (camelCase and snake_case)
          const strategies = Array.isArray(obj.strategies) ? obj.strategies 
            : Array.isArray(obj.justifiedStrategies) ? obj.justifiedStrategies 
            : Array.isArray(obj.justified_strategies) ? obj.justified_strategies 
            : Array.isArray(obj.selected_strategies) ? obj.selected_strategies 
            : [];
          if (strategies.length > 0) {
            flatCandidates.push({
              requirementId: key,
              strategies: (strategies as unknown[]).filter((s): s is string => typeof s === 'string'),
              reasons: Array.isArray(obj.reasons) ? (obj.reasons as unknown[]).filter((r): r is string => typeof r === 'string') : [],
              confidence: typeof obj.confidence === 'number' ? obj.confidence : DEFAULT_CONFIDENCE,
            });
          }
        }
      }
    }
    
    if (flatCandidates.length > 0) rawCoverage = flatCandidates;
  }

  const rawUnresolved = (Array.isArray(raw.unresolvedCandidates) ? raw.unresolvedCandidates : []) as Array<Record<string, unknown>>;

  // Handle flat AI format: { "REQ-0001": ["positive", ...], ... }
  // Also handles: { "REQ-0001": { "strategies": [...] }, ... }
  // Also handles: { "requirement_id": "REQ-0001", "justified_strategies": [...] } (DeepSeek flat format)
  if (rawCoverage.length === 0) {
    const flatCandidates: Array<Record<string, unknown>> = [];
    
    // Check for DeepSeek flat format with requirement_id and justified_strategies
    if (typeof raw.requirement_id === 'string' && validReqIds.has(raw.requirement_id)) {
      const strategies = Array.isArray(raw.justified_strategies) ? raw.justified_strategies : Array.isArray(raw.strategies) ? raw.strategies : [];
      if (strategies.length > 0) {
        flatCandidates.push({
          requirementId: raw.requirement_id,
          strategies: (strategies as unknown[]).filter((s): s is string => typeof s === 'string'),
          reasons: Array.isArray(raw.reasons) ? (raw.reasons as unknown[]).filter((r): r is string => typeof r === 'string') : [],
          confidence: typeof raw.confidence === 'number' ? raw.confidence : DEFAULT_CONFIDENCE,
        });
      }
    }
    
    // Check for standard flat format: { "REQ-0001": [...], ... }
    if (flatCandidates.length === 0) {
      for (const [key, value] of Object.entries(raw)) {
        if (!validReqIds.has(key)) continue;
        if (Array.isArray(value)) {
          flatCandidates.push({
            requirementId: key,
            strategies: value.filter((s): s is string => typeof s === 'string'),
            reasons: [],
            confidence: DEFAULT_CONFIDENCE,
          });
        } else if (typeof value === 'object' && value !== null && Array.isArray((value as Record<string, unknown>).strategies)) {
          const obj = value as Record<string, unknown>;
          flatCandidates.push({
            requirementId: key,
            strategies: (obj.strategies as unknown[]).filter((s): s is string => typeof s === 'string'),
            reasons: Array.isArray(obj.reasons) ? (obj.reasons as unknown[]).filter((r): r is string => typeof r === 'string') : [],
            confidence: typeof obj.confidence === 'number' ? obj.confidence : DEFAULT_CONFIDENCE,
          });
        }
      }
    }
    
    if (flatCandidates.length > 0) rawCoverage = flatCandidates;
  }

  const coverageCandidates: CoverageCandidate[] = [];
  for (const c of rawCoverage) {
    // Accept requirementId or id (legacy alias from DeepSeek responses)
    const reqId = typeof c.requirementId === 'string' ? c.requirementId
      : typeof c.id === 'string' ? c.id
      : '';
    if (!reqId || !validReqIds.has(reqId)) continue;

    const strategies = (Array.isArray(c.strategies) ? c.strategies : [])
      .filter((s): s is string => typeof s === 'string' && VALID_STRATEGIES.has(s)) as CoverageStrategy[];

    const reasons = (Array.isArray(c.reasons) ? c.reasons : [])
      .filter((r): r is string => typeof r === 'string');

    const confidence = typeof c.confidence === 'number' ? c.confidence : DEFAULT_CONFIDENCE;

    coverageCandidates.push({ requirementId: reqId, strategies, reasons, confidence });
  }

  const unresolvedCandidates = [];
  for (const u of rawUnresolved) {
    const reqId = typeof u.requirementId === 'string' ? u.requirementId : '';
    if (!reqId || !validReqIds.has(reqId)) continue;

    const description = typeof u.description === 'string' ? u.description : '';
    if (!description) continue;

    const reason = typeof u.reason === 'string' && VALID_UNRESOLVED_REASONS.has(u.reason)
      ? u.reason as UnresolvedReason
      : 'other';

    const provenance = normalizeTestProvenance(u.provenance);

    unresolvedCandidates.push({ requirementId: reqId, description, reason, provenance });
  }

  return { coverageCandidates, unresolvedCandidates };
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
