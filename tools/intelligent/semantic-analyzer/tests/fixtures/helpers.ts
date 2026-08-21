// ---------------------------------------------------------------------------
// Test fixtures – shared factories and helpers
// ---------------------------------------------------------------------------

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ChunkSemanticResult,
  ChunkEntity,
  ChunkSection,
  ChunkFlow,
  ChunkRule,
  ChunkRelationship,
  ChunkUnresolved,
  ProvenanceReference,
  ConsolidationResult,
  SemanticRelationship,
} from '../../src/models.js';
import type { ContextChunk } from '../../src/persistence/loader.js';
import { FakeAIProvider } from 'ai-provider';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Path to the on-disk valid context fixture. */
export const VALID_CONTEXT_DIR = path.join(__dirname, 'valid-context');

// ---- Provenance factories -------------------------------------------------

export function prov(contextId: string, sheet?: string, cells?: string[]): ProvenanceReference {
  return { contextId, sheet, cells };
}

// ---- Chunk entity factory -------------------------------------------------

export function chunkEntity(overrides: Partial<ChunkEntity> & { localId: string; name: string; type: string }): ChunkEntity {
  return {
    confidence: 0.9,
    provenance: [prov('ctx-test-000', 'Business Rules', ['A2'])],
    ...overrides,
  };
}

// ---- Chunk section factory ------------------------------------------------

export function chunkSection(overrides: Partial<ChunkSection> & { localId: string; title: string }): ChunkSection {
  return {
    confidence: 0.9,
    provenance: [prov('ctx-test-000', 'Business Rules', ['A1'])],
    ...overrides,
  };
}

// ---- Chunk flow factory ---------------------------------------------------

export function chunkFlow(overrides: Partial<ChunkFlow> & { localId: string; name: string }): ChunkFlow {
  return {
    steps: [],
    confidence: 0.9,
    provenance: [prov('ctx-test-000', 'Business Rules', ['A2'])],
    ...overrides,
  };
}

// ---- Chunk rule factory ---------------------------------------------------

export function chunkRule(overrides: Partial<ChunkRule> & { localId: string; type: string; statement: string }): ChunkRule {
  return {
    confidence: 0.9,
    provenance: [prov('ctx-test-000', 'Business Rules', ['A2'])],
    ...overrides,
  };
}

// ---- Chunk relationship factory -------------------------------------------

export function chunkRel(overrides: Partial<ChunkRelationship> & { localId: string; type: string; sourceLocalId: string; targetLocalId: string }): ChunkRelationship {
  return {
    confidence: 0.9,
    provenance: [prov('ctx-test-000', 'Business Rules', ['A2'])],
    ...overrides,
  };
}

// ---- Chunk unresolved factory ---------------------------------------------

export function chunkUnresolved(overrides: Partial<ChunkUnresolved> & { localId: string; type: string; description: string; reason: string }): ChunkUnresolved {
  return {
    provenance: [prov('ctx-test-000', 'Business Rules', ['A2'])],
    ...overrides,
  };
}

// ---- ChunkSemanticResult factory ------------------------------------------

export function chunkResult(overrides: Partial<ChunkSemanticResult> & { contextId: string }): ChunkSemanticResult {
  return {
    sections: [],
    entities: [],
    flows: [],
    rules: [],
    relationships: [],
    unresolved: [],
    ...overrides,
  };
}

// ---- ContextChunk factory -------------------------------------------------

export function contextChunk(overrides: Partial<ContextChunk> & { id: string }): ContextChunk {
  return {
    schemaVersion: '1.0',
    type: 'tabular',
    sheet: { index: 0, name: 'TestSheet' },
    range: 'A1:D5',
    content: 'Sheet: TestSheet\nRange: A1:D5\n\nColumns:\nA: ID\nB: Name\n\nRows:\n1 | test',
    provenance: { sheetIndex: 0, sheetName: 'TestSheet', ranges: ['A1:D5'] },
    relations: { previous: null, next: null, references: [] },
    layoutHints: { headerRows: [1] },
    stats: { cells: 10, characters: 100, estimatedTokens: 25 },
    warnings: [],
    ...overrides,
  } as ContextChunk;
}

// ---- ConsolidationResult factory ------------------------------------------

export function consolidationResult(overrides?: Partial<ConsolidationResult>): ConsolidationResult {
  return {
    mergeCandidates: [],
    crossChunkRelationships: [],
    ...overrides,
  };
}

// ---- SemanticRelationship factory -----------------------------------------

export function semanticRel(overrides: Partial<SemanticRelationship> & { id: string; type: string; sourceId: string; targetId: string }): SemanticRelationship {
  return {
    confidence: 0.9,
    provenance: [prov('ctx-test-000')],
    ...overrides,
  };
}

// ---- FakeAIProvider builder -----------------------------------------------

/**
 * Build a FakeAIProvider with properly queued responses for the two-pass
 * semantic analysis pipeline.
 *
 * @param chunkResponses One ChunkSemanticResult per chunk (Pass 1)
 * @param consolidationResponse Single ConsolidationResult (Pass 2)
 */
export function buildFakeProvider(
  chunkResponses: ChunkSemanticResult[],
  consolidationResponse?: ConsolidationResult,
): FakeAIProvider {
  const responses: unknown[] = [
    ...chunkResponses,
    consolidationResponse ?? consolidationResult(),
  ];
  return new FakeAIProvider({
    name: 'fake',
    model: 'fake-model',
    responses,
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
  });
}
