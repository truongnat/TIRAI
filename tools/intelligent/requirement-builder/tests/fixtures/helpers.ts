// ---------------------------------------------------------------------------
// Test fixtures – shared factories and helpers
// ---------------------------------------------------------------------------

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  SemanticIRInput,
  ProvenanceReference,
  RequirementCandidate,
  CandidateExtractionResult,
  RequirementConsolidationResult,
} from '../../src/models.js';
import { FakeAIProvider } from 'ai-provider';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Path to the on-disk valid Semantic IR fixture. */
export const VALID_SEMANTIC_IR_DIR = path.join(__dirname, 'valid-semantic-ir');

// ---- Provenance factories -------------------------------------------------

export function prov(contextId: string, sheet?: string, cells?: string[]): ProvenanceReference {
  return { contextId, sheet, cells };
}

// ---- Semantic IR factory --------------------------------------------------

export function semanticIR(overrides?: Partial<SemanticIRInput>): SemanticIRInput {
  return {
    schemaVersion: '1.0',
    status: 'complete',
    document: {
      title: 'Test Document',
      summary: 'A test specification',
      provenance: [prov('ctx-s000-c000', 'Business Flow')],
    },
    sections: [
      { id: 'sec-0001', title: 'Business Flow', provenance: [prov('ctx-s000-c000', 'Business Flow')], confidence: 0.9 },
    ],
    entities: [
      { id: 'ent-0001', name: 'Login Screen', type: 'ui', provenance: [prov('ctx-s000-c000', 'Business Flow')], confidence: 0.9 },
      { id: 'ent-0002', name: 'User', type: 'actor', provenance: [prov('ctx-s000-c000', 'Business Flow')], confidence: 0.9 },
    ],
    flows: [
      {
        id: 'flow-0001',
        name: 'Login Process',
        steps: [
          { order: 1, action: 'User enters username', actor: 'User', provenance: [prov('ctx-s000-c000', 'Business Flow')] },
          { order: 2, action: 'User enters password', actor: 'User', provenance: [prov('ctx-s000-c000', 'Business Flow')] },
          { order: 3, action: 'System validates credentials', actor: 'System', provenance: [prov('ctx-s000-c000', 'Business Flow')] },
        ],
        provenance: [prov('ctx-s000-c000', 'Business Flow')],
        confidence: 0.9,
      },
    ],
    rules: [
      {
        id: 'rule-0001',
        type: 'validation',
        statement: 'Username is required',
        provenance: [prov('ctx-s000-c000', 'Business Flow')],
        confidence: 0.9,
      },
    ],
    relationships: [],
    unresolved: [],
    analysis: {
      provider: 'fake',
      model: 'fake-model',
      promptVersion: '1.1',
      chunksAnalyzed: 1,
      aiRequests: 2,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      warnings: [],
    },
    ...overrides,
  };
}

// ---- Requirement candidate factory ----------------------------------------

export function candidate(overrides: Partial<RequirementCandidate> & { temporaryId: string; statement: string }): RequirementCandidate {
  return {
    title: overrides.statement.slice(0, 80),
    type: 'functional',
    sourceNature: 'explicit',
    semanticEvidenceIds: ['flow-0001'],
    provenance: [prov('ctx-s000-c000', 'Business Flow')],
    confidence: 0.9,
    preconditions: [],
    inputs: [],
    expectedBehaviors: [{ description: 'Validate input', provenance: [prov('ctx-s000-c000')] }],
    outcomes: [],
    constraints: [],
    ...overrides,
  };
}

// ---- Candidate extraction result factory ----------------------------------

export function extractionResult(overrides?: Partial<CandidateExtractionResult>): CandidateExtractionResult {
  return {
    candidates: [],
    unresolvedCandidates: [],
    conflictCandidates: [],
    ...overrides,
  };
}

// ---- Consolidation result factory -----------------------------------------

export function consolidationResult(overrides?: Partial<RequirementConsolidationResult>): RequirementConsolidationResult {
  return {
    duplicateGroups: [],
    additionalConflicts: [],
    ...overrides,
  };
}

// ---- FakeAIProvider builder -----------------------------------------------

/**
 * Build a FakeAIProvider with queued responses for the requirement builder pipeline.
 *
 * @param extractionResponses One CandidateExtractionResult per batch
 * @param consolidationResponse Single consolidation response
 */
export function buildFakeProvider(
  extractionResponses: CandidateExtractionResult[],
  consolidationResponse?: RequirementConsolidationResult,
): FakeAIProvider {
  const responses: unknown[] = [
    ...extractionResponses,
    consolidationResponse ?? consolidationResult(),
  ];
  return new FakeAIProvider({
    name: 'fake',
    model: 'fake-model',
    responses,
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
  });
}
