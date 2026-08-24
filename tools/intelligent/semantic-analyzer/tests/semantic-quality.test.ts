// ---------------------------------------------------------------------------
// v1.1 semantic quality tests — flows, rules, relationships, quality metrics
// ---------------------------------------------------------------------------
// Tests the v1.1 improvements: flow extraction, rule extraction,
// relationship extraction, quality metrics, and prompt version bump.

import { describe, it, expect } from 'vitest';
import { analyzeSemanticContext } from '../src/analyzer.js';
import { PROMPT_VERSION } from '../src/prompts/system.js';
import { buildChunkAnalysisPrompt } from '../src/prompts/chunk.js';
import { buildConsolidationPrompt } from '../src/prompts/consolidation.js';
import {
  contextChunk,
  VALID_CONTEXT_DIR,
  prov,
  chunkEntity,
  chunkFlow,
  chunkRule,
  chunkRel,
  chunkResult,
  buildFakeProvider,
} from './fixtures/helpers.js';
import type { ChunkSemanticResult, ConsolidationResult } from '../src/models.js';

// ---- Prompt version -------------------------------------------------------

describe('Prompt version', () => {
  it('should be 1.1', () => {
    expect(PROMPT_VERSION).toBe('1.2');
  });
});

// ---- Flow extraction ------------------------------------------------------

describe('Flow extraction (v1.1)', () => {
  it('should extract explicit ordered flow with steps', async () => {
    const chunkResp: ChunkSemanticResult = {
      contextId: 'ctx-test-000',
      sections: [],
      entities: [
        chunkEntity({ localId: 'local-entity-001', name: 'Login Screen', type: 'screen' }),
        chunkEntity({ localId: 'local-entity-002', name: 'Login API', type: 'api' }),
      ],
      flows: [
        chunkFlow({
          localId: 'local-flow-001',
          name: 'Authentication flow',
          steps: [
            { order: 1, action: 'Open page', actor: 'User', target: 'Login Screen', provenance: [prov('ctx-test-000', 'Business Rules', ['A2'])] },
            { order: 2, action: 'Enter credentials', actor: 'User', provenance: [prov('ctx-test-000', 'Business Rules', ['A3'])] },
            { order: 3, action: 'Submit form', actor: 'User', provenance: [prov('ctx-test-000', 'Business Rules', ['A4'])] },
            { order: 4, action: 'Validate input', actor: 'System', provenance: [prov('ctx-test-000', 'Business Rules', ['A5'])] },
          ],
          provenance: [prov('ctx-test-000', 'Business Rules', ['A2:A5'])],
        }),
      ],
      rules: [],
      relationships: [],
      unresolved: [],
    };

    const provider = buildFakeProvider([chunkResp]);
    const ir = await analyzeSemanticContext(VALID_CONTEXT_DIR, provider);

    expect(ir.flows.length).toBeGreaterThanOrEqual(1);
    const flow = ir.flows[0]!;
    expect(flow.name).toBe('Authentication flow');
    expect(flow.steps).toHaveLength(4);
    // Steps should maintain order
    expect(flow.steps[0]!.order).toBe(1);
    expect(flow.steps[1]!.order).toBe(2);
    expect(flow.steps[2]!.order).toBe(3);
    expect(flow.steps[3]!.order).toBe(4);
    // Steps should have actors
    expect(flow.steps[0]!.actor).toBe('User');
    expect(flow.steps[3]!.actor).toBe('System');
  });

  it('should preserve flow step provenance', async () => {
    const chunkResp: ChunkSemanticResult = {
      contextId: 'ctx-test-000',
      sections: [],
      entities: [],
      flows: [
        chunkFlow({
          localId: 'local-flow-001',
          name: 'Test flow',
          steps: [
            { order: 1, action: 'Step one', provenance: [prov('ctx-test-000', 'Business Rules', ['A2'])] },
            { order: 2, action: 'Step two', provenance: [prov('ctx-test-000', 'Business Rules', ['A3'])] },
          ],
          provenance: [prov('ctx-test-000', 'Business Rules', ['A2:A3'])],
        }),
      ],
      rules: [],
      relationships: [],
      unresolved: [],
    };

    const provider = buildFakeProvider([chunkResp]);
    const ir = await analyzeSemanticContext(VALID_CONTEXT_DIR, provider);

    expect(ir.flows[0]!.steps[0]!.provenance).toBeDefined();
    expect(ir.flows[0]!.steps[0]!.provenance.length).toBeGreaterThanOrEqual(1);
    expect(ir.flows[0]!.steps[0]!.provenance[0]!.contextId).toBe('ctx-test-000');
  });

  it('should assign deterministic flow IDs', async () => {
    const chunkResp: ChunkSemanticResult = {
      contextId: 'ctx-test-000',
      sections: [],
      entities: [],
      flows: [
        chunkFlow({ localId: 'local-flow-001', name: 'Flow A', steps: [{ order: 1, action: 'Do A', provenance: [prov('ctx-test-000')] }] }),
        chunkFlow({ localId: 'local-flow-002', name: 'Flow B', steps: [{ order: 1, action: 'Do B', provenance: [prov('ctx-test-000')] }] }),
      ],
      rules: [],
      relationships: [],
      unresolved: [],
    };

    const provider = buildFakeProvider([chunkResp]);
    const ir = await analyzeSemanticContext(VALID_CONTEXT_DIR, provider);

    expect(ir.flows).toHaveLength(2);
    expect(ir.flows[0]!.id).toMatch(/^flow-/);
    expect(ir.flows[1]!.id).toMatch(/^flow-/);
    expect(ir.flows[0]!.id).not.toBe(ir.flows[1]!.id);
  });
});

// ---- Rule extraction ------------------------------------------------------

describe('Rule extraction (v1.1)', () => {
  it('should extract validation rules', async () => {
    const chunkResp: ChunkSemanticResult = {
      contextId: 'ctx-test-000',
      sections: [],
      entities: [
        chunkEntity({ localId: 'local-entity-001', name: 'username', type: 'field' }),
      ],
      flows: [],
      rules: [
        chunkRule({
          localId: 'local-rule-001',
          type: 'validation',
          statement: 'Username is required',
          provenance: [prov('ctx-test-000', 'Business Rules', ['B2'])],
        }),
        chunkRule({
          localId: 'local-rule-002',
          type: 'validation',
          statement: 'Password must contain at least 8 characters',
          provenance: [prov('ctx-test-000', 'Business Rules', ['B3'])],
        }),
        chunkRule({
          localId: 'local-rule-003',
          type: 'transition',
          statement: 'If inactive, login must be rejected',
          provenance: [prov('ctx-test-000', 'Business Rules', ['B4'])],
        }),
      ],
      relationships: [],
      unresolved: [],
    };

    const provider = buildFakeProvider([chunkResp]);
    const ir = await analyzeSemanticContext(VALID_CONTEXT_DIR, provider);

    expect(ir.rules).toHaveLength(3);
    expect(ir.rules[0]!.type).toBe('validation');
    expect(ir.rules[0]!.statement).toBe('Username is required');
    expect(ir.rules[1]!.statement).toContain('8 characters');
    expect(ir.rules[2]!.type).toBe('transition');
  });

  it('should assign deterministic rule IDs', async () => {
    const chunkResp: ChunkSemanticResult = {
      contextId: 'ctx-test-000',
      sections: [],
      entities: [],
      flows: [],
      rules: [
        chunkRule({ localId: 'local-rule-001', type: 'validation', statement: 'Rule A' }),
        chunkRule({ localId: 'local-rule-002', type: 'constraint', statement: 'Rule B' }),
      ],
      relationships: [],
      unresolved: [],
    };

    const provider = buildFakeProvider([chunkResp]);
    const ir = await analyzeSemanticContext(VALID_CONTEXT_DIR, provider);

    expect(ir.rules).toHaveLength(2);
    expect(ir.rules[0]!.id).toMatch(/^rule-/);
    expect(ir.rules[1]!.id).toMatch(/^rule-/);
  });
});

// ---- Relationship extraction ----------------------------------------------

describe('Relationship extraction (v1.1)', () => {
  it('should extract local relationships within a chunk', async () => {
    const chunkResp: ChunkSemanticResult = {
      contextId: 'ctx-test-000',
      sections: [],
      entities: [
        chunkEntity({ localId: 'local-entity-001', name: 'LoginPage', type: 'module' }),
        chunkEntity({ localId: 'local-entity-002', name: 'POST /login', type: 'api' }),
      ],
      flows: [],
      rules: [],
      relationships: [
        chunkRel({
          localId: 'local-rel-001',
          type: 'calls',
          sourceLocalId: 'local-entity-001',
          targetLocalId: 'local-entity-002',
          description: 'LoginPage calls login API',
          provenance: [prov('ctx-test-000', 'Business Rules', ['C2'])],
        }),
      ],
      unresolved: [],
    };

    const provider = buildFakeProvider([chunkResp]);
    const ir = await analyzeSemanticContext(VALID_CONTEXT_DIR, provider);

    expect(ir.relationships.length).toBeGreaterThanOrEqual(1);
    const rel = ir.relationships.find((r) => r.type === 'calls');
    expect(rel).toBeDefined();
    expect(rel!.sourceId).toMatch(/^ent-/);
    expect(rel!.targetId).toMatch(/^ent-/);
  });

  it('should resolve cross-chunk relationships via consolidation', async () => {
    // Chunk A has a LoginPage that references API-001
    const chunkAResp: ChunkSemanticResult = {
      contextId: 'ctx-test-000',
      sections: [],
      entities: [
        chunkEntity({ localId: 'local-entity-001', name: 'LoginPage', type: 'module' }),
        chunkEntity({ localId: 'local-entity-002', name: 'API-001', type: 'api' }),
      ],
      flows: [],
      rules: [],
      relationships: [
        chunkRel({
          localId: 'local-rel-001',
          type: 'calls',
          sourceLocalId: 'local-entity-001',
          targetLocalId: 'local-entity-002',
          provenance: [prov('ctx-test-000')],
        }),
      ],
      unresolved: [],
    };

    // Chunk B has the same API-001 entity
    const chunkBResp: ChunkSemanticResult = {
      contextId: 'ctx-test-001',
      sections: [],
      entities: [
        chunkEntity({
          localId: 'local-entity-001',
          name: 'API-001',
          type: 'api',
          provenance: [prov('ctx-test-001', 'UI Design', ['A2'])],
        }),
      ],
      flows: [],
      rules: [],
      relationships: [],
      unresolved: [],
    };

    const consResp: ConsolidationResult = {
      mergeCandidates: [
        {
          sourceLocalIds: ['ctx-test-000:local-entity-002', 'ctx-test-001:local-entity-001'],
          reason: 'Both represent API-001',
          confidence: 0.95,
        },
      ],
      crossChunkRelationships: [],
    };

    const provider = buildFakeProvider([chunkAResp, chunkBResp], consResp);
    const ir = await analyzeSemanticContext(VALID_CONTEXT_DIR, provider);

    // The intra-chunk relationship should be resolved
    expect(ir.relationships.length).toBeGreaterThanOrEqual(1);
    const callsRel = ir.relationships.find((r) => r.type === 'calls');
    expect(callsRel).toBeDefined();
  });

  it('should not create dangling relationships', async () => {
    const chunkResp: ChunkSemanticResult = {
      contextId: 'ctx-test-000',
      sections: [],
      entities: [
        chunkEntity({ localId: 'local-entity-001', name: 'ModuleA', type: 'module' }),
      ],
      flows: [],
      rules: [],
      relationships: [
        chunkRel({
          localId: 'local-rel-001',
          type: 'depends-on',
          sourceLocalId: 'local-entity-001',
          targetLocalId: 'local-entity-999', // Non-existent target
          provenance: [prov('ctx-test-000')],
        }),
      ],
      unresolved: [],
    };

    const provider = buildFakeProvider([chunkResp]);
    const ir = await analyzeSemanticContext(VALID_CONTEXT_DIR, provider);

    // Dangling relationship should generate a warning
    const danglingWarnings = ir.analysis.warnings.filter(
      (w) => w.code === 'SEMANTIC_RELATIONSHIP_UNRESOLVED',
    );
    expect(danglingWarnings.length).toBeGreaterThanOrEqual(1);
  });
});

// ---- Quality metrics ------------------------------------------------------

describe('Quality metrics (v1.1)', () => {
  it('should include quality metrics in analysis', async () => {
    const chunkResp: ChunkSemanticResult = {
      contextId: 'ctx-test-000',
      sections: [],
      entities: [
        chunkEntity({ localId: 'local-entity-001', name: 'User', type: 'table' }),
      ],
      flows: [
        chunkFlow({
          localId: 'local-flow-001',
          name: 'Login',
          steps: [
            { order: 1, action: 'Step 1', provenance: [prov('ctx-test-000')] },
            { order: 2, action: 'Step 2', provenance: [prov('ctx-test-000')] },
            { order: 3, action: 'Step 3', provenance: [prov('ctx-test-000')] },
          ],
        }),
      ],
      rules: [
        chunkRule({ localId: 'local-rule-001', type: 'validation', statement: 'Required field' }),
      ],
      relationships: [],
      unresolved: [],
    };

    const provider = buildFakeProvider([chunkResp]);
    const ir = await analyzeSemanticContext(VALID_CONTEXT_DIR, provider);

    expect(ir.analysis.quality).toBeDefined();
    const q = ir.analysis.quality!;
    expect(q.entities).toBeGreaterThanOrEqual(1);
    expect(q.flows).toBeGreaterThanOrEqual(1);
    expect(q.flowSteps).toBe(3);
    expect(q.rules).toBeGreaterThanOrEqual(1);
    expect(q.provenanceCoverage).toBeGreaterThan(0);
    expect(q.provenanceCoverage).toBeLessThanOrEqual(1);
  });

  it('should count low confidence objects', async () => {
    const chunkResp: ChunkSemanticResult = {
      contextId: 'ctx-test-000',
      sections: [],
      entities: [
        chunkEntity({ localId: 'local-entity-001', name: 'Low', type: 'x', confidence: 0.3 }),
        chunkEntity({ localId: 'local-entity-002', name: 'High', type: 'y', confidence: 0.9 }),
      ],
      flows: [],
      rules: [],
      relationships: [],
      unresolved: [],
    };

    const provider = buildFakeProvider([chunkResp]);
    const ir = await analyzeSemanticContext(VALID_CONTEXT_DIR, provider);

    expect(ir.analysis.quality!.lowConfidenceCount).toBeGreaterThanOrEqual(1);
  });
});

// ---- Prompt structure -----------------------------------------------------

describe('Prompt structure (v1.1)', () => {
  it('chunk prompt should include flow detection section', () => {
    const chunk = contextChunk({ id: 'ctx-test-000' });
    const prompt = buildChunkAnalysisPrompt(chunk);

    expect(prompt).toContain('FLOW DETECTION');
    expect(prompt).toContain('RULE DETECTION');
    expect(prompt).toContain('RELATIONSHIP DETECTION');
    expect(prompt).toContain('EVIDENCE REQUIREMENTS');
    expect(prompt).toContain('SOURCE SAFETY');
    expect(prompt).toContain('Return JSON only');
  });

  it('chunk prompt should emphasize flows over entities for ordered content', () => {
    const chunk = contextChunk({ id: 'ctx-test-000' });
    const prompt = buildChunkAnalysisPrompt(chunk);

    expect(prompt).toContain('Do NOT create separate entities for each step');
    expect(prompt).toContain('create FLOWS');
  });

  it('consolidation prompt should include cross-chunk flow and relationship tasks', () => {
    const results: ChunkSemanticResult[] = [
      chunkResult({ contextId: 'ctx-test-000' }),
    ];
    const prompt = buildConsolidationPrompt(results, ['Sheet1']);

    expect(prompt).toContain('CROSS-CHUNK FLOWS');
    expect(prompt).toContain('CROSS-CHUNK RELATIONSHIPS');
    expect(prompt).toContain('EXPLICIT evidence');
  });
});
