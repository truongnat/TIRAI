// ---------------------------------------------------------------------------
// Loader tests – input validation (spec §64)
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadSemanticIR } from '../src/persistence/loader.js';
import { VALID_SEMANTIC_IR_DIR } from './fixtures/helpers.js';

describe('Loader – input validation', () => {
  it('1. loads valid Semantic IR', () => {
    const ir = loadSemanticIR(VALID_SEMANTIC_IR_DIR);
    expect(ir.schemaVersion).toBe('1.0');
    expect(ir.flows.length).toBeGreaterThan(0);
    expect(ir.entities.length).toBeGreaterThan(0);
  });

  it('2. throws on missing directory', () => {
    expect(() => loadSemanticIR('/nonexistent/path')).toThrowError('Input directory not found');
  });

  it('3. throws on malformed JSON', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-test-'));
    fs.writeFileSync(path.join(tmpDir, 'semantic-ir.json'), '{ broken json', 'utf-8');
    expect(() => loadSemanticIR(tmpDir)).toThrowError('Failed to parse');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('4. throws on unsupported schema version', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-test-'));
    fs.writeFileSync(path.join(tmpDir, 'semantic-ir.json'), JSON.stringify({
      schemaVersion: '2.0',
      document: { provenance: [] },
      sections: [], entities: [], flows: [], rules: [], relationships: [], unresolved: [],
    }), 'utf-8');
    expect(() => loadSemanticIR(tmpDir)).toThrowError('Unsupported Semantic IR schema version');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('5. throws on missing semantic-ir.json', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-test-'));
    expect(() => loadSemanticIR(tmpDir)).toThrowError('semantic-ir.json not found');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('6. throws on missing document', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-test-'));
    fs.writeFileSync(path.join(tmpDir, 'semantic-ir.json'), JSON.stringify({
      schemaVersion: '1.0',
      sections: [], entities: [], flows: [], rules: [], relationships: [], unresolved: [],
    }), 'utf-8');
    expect(() => loadSemanticIR(tmpDir)).toThrowError('missing document');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('7. throws on entity missing id', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-test-'));
    fs.writeFileSync(path.join(tmpDir, 'semantic-ir.json'), JSON.stringify({
      schemaVersion: '1.0',
      document: { provenance: [] },
      sections: [], entities: [{ name: 'Test', type: 'x', provenance: [], confidence: 0.9 }],
      flows: [], rules: [], relationships: [], unresolved: [],
    }), 'utf-8');
    expect(() => loadSemanticIR(tmpDir)).toThrowError('Entity missing required fields');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('8. throws on flow missing steps', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-test-'));
    fs.writeFileSync(path.join(tmpDir, 'semantic-ir.json'), JSON.stringify({
      schemaVersion: '1.0',
      document: { provenance: [] },
      sections: [], entities: [],
      flows: [{ id: 'f1', name: 'Test' }],
      rules: [], relationships: [], unresolved: [],
    }), 'utf-8');
    expect(() => loadSemanticIR(tmpDir)).toThrowError('Flow missing required fields');
    fs.rmSync(tmpDir, { recursive: true });
  });
});
