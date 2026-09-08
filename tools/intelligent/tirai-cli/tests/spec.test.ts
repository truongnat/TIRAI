import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { runSpecAdd, runSpecList, runSpecInspect, loadSpecRegistry } from '../src/commands/spec.js';

describe('spec registry', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(tmpdir(), 'tirai-spec-'));
    fs.mkdirSync(path.join(tmp, '.tirai', 'specs'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.tirai', 'config.json'), JSON.stringify({
      version: 2,
      workspaceVersion: 1,
      ai: { provider: 'fake', model: 'fake-model' },
      project: { root: tmp, defaultEnvironment: 'local', defaultLanguage: 'en' },
      platforms: {},
      source: {},
      e2e: { baseUrl: 'http://localhost:4173' },
      unit: { projectRoot: tmp, language: 'typescript' },
    }), 'utf8');
    fs.writeFileSync(path.join(tmp, '.tirai', 'specs', 'index.json'), JSON.stringify({ specs: [] }), 'utf8');
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('adds a spec to the registry', async () => {
    const specFile = path.join(tmp, 'test-spec.xlsx');
    fs.writeFileSync(specFile, 'fake excel content');
    await runSpecAdd({ cwd: tmp, sourcePath: specFile, name: 'Test Spec' });
    const paths = { specsIndexPath: path.join(tmp, '.tirai', 'specs', 'index.json') };
    const registry = loadSpecRegistry(paths);
    expect(registry.specs).toHaveLength(1);
    expect(registry.specs[0].name).toBe('Test Spec');
    expect(registry.specs[0].sourceType).toBe('xlsx');
  });

  it('rejects duplicate specs by fingerprint', async () => {
    const specFile = path.join(tmp, 'test-spec.xlsx');
    fs.writeFileSync(specFile, 'fake excel content');
    await runSpecAdd({ cwd: tmp, sourcePath: specFile });
    let error: Error | null = null;
    try {
      await runSpecAdd({ cwd: tmp, sourcePath: specFile });
    } catch (e) {
      error = e as Error;
    }
    expect(error).not.toBeNull();
    expect(error!.message).toContain('already registered');
  });

  it('lists registered specs', async () => {
    const specFile = path.join(tmp, 'test-spec.xlsx');
    fs.writeFileSync(specFile, 'fake excel content');
    await runSpecAdd({ cwd: tmp, sourcePath: specFile, name: 'My Spec' });
    await runSpecList({ cwd: tmp, json: true });
  });

  it('inspects a spec', async () => {
    const specFile = path.join(tmp, 'test-spec.xlsx');
    fs.writeFileSync(specFile, 'fake excel content');
    await runSpecAdd({ cwd: tmp, sourcePath: specFile, name: 'Inspect Me' });
    const paths = { specsIndexPath: path.join(tmp, '.tirai', 'specs', 'index.json') };
    const registry = loadSpecRegistry(paths);
    const specId = registry.specs[0].id;
    await runSpecInspect({ cwd: tmp, specId, json: true });
  });

  it('detects source type from extension', async () => {
    const testCases = [
      { name: 'test.xlsx', type: 'xlsx' },
      { name: 'test.pdf', type: 'pdf' },
      { name: 'test.docx', type: 'docx' },
      { name: 'test.md', type: 'markdown' },
      { name: 'test.csv', type: 'csv' },
      { name: 'test.json', type: 'json' },
    ];
    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i];
      const f = path.join(tmp, tc.name);
      // Unique content per file to avoid fingerprint collision
      fs.writeFileSync(f, 'unique-content-' + i);
      await runSpecAdd({ cwd: tmp, sourcePath: f });
    }
    const paths = { specsIndexPath: path.join(tmp, '.tirai', 'specs', 'index.json') };
    const registry = loadSpecRegistry(paths);
    for (const tc of testCases) {
      const spec = registry.specs.find((s) => s.sourceType === tc.type);
      expect(spec).toBeDefined();
    }
  });
});
