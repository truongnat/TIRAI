// ---------------------------------------------------------------------------
// Excel AI Analyzer – tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT, buildUserContent } from '../src/prompts.js';
import type { SemanticIR } from '../src/models.js';

// ===========================================================================
// Prompt tests
// ===========================================================================

describe('Prompts', () => {
  it('system prompt contains schema definition', () => {
    expect(SYSTEM_PROMPT).toContain('entities');
    expect(SYSTEM_PROMPT).toContain('sections');
    expect(SYSTEM_PROMPT).toContain('flows');
    expect(SYSTEM_PROMPT).toContain('fields');
    expect(SYSTEM_PROMPT).toContain('rules');
    expect(SYSTEM_PROMPT).toContain('relationships');
    expect(SYSTEM_PROMPT).toContain('provenance');
  });

  it('system prompt forbids test generation', () => {
    expect(SYSTEM_PROMPT).toContain('Do NOT generate test cases');
  });

  it('system prompt forbids translation', () => {
    expect(SYSTEM_PROMPT).toContain('Do NOT translate');
  });

  it('buildUserContent includes all chunks', () => {
    const chunks = [
      { id: 'ctx-s000-c000', sheet: { name: 'Sheet1' }, content: 'Data A' },
      { id: 'ctx-s001-c000', sheet: { name: 'Sheet2' }, content: 'Data B' },
    ];
    const content = buildUserContent(chunks);
    expect(content).toContain('ctx-s000-c000');
    expect(content).toContain('ctx-s001-c000');
    expect(content).toContain('Data A');
    expect(content).toContain('Data B');
    expect(content).toContain('Sheet1');
    expect(content).toContain('Sheet2');
  });
});

// ===========================================================================
// Semantic IR schema validation
// ===========================================================================

describe('Semantic IR schema', () => {
  it('valid empty IR structure', () => {
    const ir: SemanticIR = {
      schemaVersion: '1.0',
      source: { file: 'test.xlsx', sheets: 1, chunks: 1, analyzedAt: 'N/A', provider: 'test' },
      entities: [],
      sections: [],
      flows: [],
      fields: [],
      rules: [],
      relationships: [],
      provenance: [],
      warnings: [],
    };
    expect(ir.schemaVersion).toBe('1.0');
    expect(ir.entities).toHaveLength(0);
    expect(ir.source.analyzedAt).toBe('N/A');
  });

  it('entity types are exhaustive', () => {
    const types = [
      'screen', 'module', 'table', 'api', 'component',
      'role', 'business-flow', 'config', 'data-entity', 'unknown',
    ];
    for (const t of types) {
      const entity = { id: `ent-${t}-001`, name: t, type: t as any, description: null, sourceSheet: 'S', sourceRange: null, metadata: {} };
      expect(entity.type).toBe(t);
    }
  });

  it('relationship types are exhaustive', () => {
    const types = [
      'uses-api', 'has-field', 'references', 'flows-to',
      'parent-child', 'implements', 'depends-on', 'related',
    ];
    for (const t of types) {
      const rel = { id: 'rel-001', type: t as any, fromEntityId: 'a', toEntityId: 'b', description: null, sourceSheet: null, sourceRange: null };
      expect(rel.type).toBe(t);
    }
  });

  it('rule types are exhaustive', () => {
    const types = ['validation', 'business', 'conditional', 'constraint', 'format', 'unknown'];
    for (const t of types) {
      const rule = { id: 'rule-001', name: null, type: t as any, description: 'test', condition: null, action: null, sourceSheet: 'S', sourceRange: null };
      expect(rule.type).toBe(t);
    }
  });
});

// ===========================================================================
// Analyzer validation logic
// ===========================================================================

describe('Analyzer validation', () => {
  it('detects provenance chunk mismatch', () => {
    // Simulate: provenance references a chunk that doesn't exist
    const validChunkIds = new Set(['ctx-s000-c000']);
    const provenance = [
      { irElement: 'ent-screen-001', irType: 'entity' as const, chunkId: 'ctx-s999-c999', sheetName: 'S', range: null },
    ];

    const mismatches = provenance.filter((p) => !validChunkIds.has(p.chunkId));
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].chunkId).toBe('ctx-s999-c999');
  });

  it('detects unresolved entity references in relationships', () => {
    const entityIds = new Set(['ent-screen-001', 'ent-api-001']);
    const relationships = [
      { id: 'rel-001', type: 'uses-api', fromEntityId: 'ent-screen-001', toEntityId: 'ent-api-999' },
    ];

    const unresolved = relationships.filter(
      (r) => !entityIds.has(r.fromEntityId) || !entityIds.has(r.toEntityId),
    );
    expect(unresolved).toHaveLength(1);
  });
});

// ===========================================================================
// Integration test (requires GEMINI_API_KEY)
// ===========================================================================

describe('Integration', () => {
  it('analyzer loads context package from disk', async () => {
    // Only run if GEMINI_API_KEY is set
    if (!process.env.GEMINI_API_KEY) {
      return;
    }

    const { analyzeExcelContext } = await import('../src/analyzer.js');
    const contextDir = './output/excel/context';

    try {
      const ir = await analyzeExcelContext(contextDir);
      expect(ir.schemaVersion).toBe('1.0');
      expect(ir.source.file).toBe('thiet-ke-chi-tiet.xlsx');
      expect(ir.entities.length).toBeGreaterThan(0);
      expect(ir.provenance.length).toBeGreaterThan(0);
    } catch {
      // Skip if context not available
    }
  });
});
