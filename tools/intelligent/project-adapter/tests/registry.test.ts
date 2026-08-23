// Registry + adapter contract + path safety tests.

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import {
  ProjectAdapterRegistry,
  JsonProjectAdapter,
  assertWithinRoot,
  type ProjectAdapter,
  type ProjectExecutionProfile,
} from '../src/index.js';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const SAMPLE = resolve(FIXTURES, 'sample-project');

// ---- Adapter Registry ----

describe('Adapter Registry', () => {
  it('1. register adds adapter', () => {
    const reg = new ProjectAdapterRegistry();
    reg.register(new JsonProjectAdapter());
    expect(reg.size).toBe(1);
  });

  it('2. resolve finds matching adapter', async () => {
    const reg = new ProjectAdapterRegistry();
    reg.register(new JsonProjectAdapter());
    const adapter = await reg.resolve({ projectRoot: SAMPLE });
    expect(adapter.id).toBe('json-project-adapter');
  });

  it('3. unsupported throws PROJECT_ADAPTER_NOT_FOUND', async () => {
    const reg = new ProjectAdapterRegistry();
    await expect(
      reg.resolve({ projectRoot: '/nonexistent' }),
    ).rejects.toThrow('No adapter can load');
  });

  it('4. deterministic tie — first registered wins at equal score', async () => {
    const reg = new ProjectAdapterRegistry();
    const a1: ProjectAdapter = {
      id: 'a1', version: '1.0.0',
      canLoad: async () => ({ supported: true, score: 5, reasons: [] }),
      load: async () => ({} as ProjectExecutionProfile),
    };
    const a2: ProjectAdapter = {
      id: 'a2', version: '1.0.0',
      canLoad: async () => ({ supported: true, score: 5, reasons: [] }),
      load: async () => ({} as ProjectExecutionProfile),
    };
    reg.register(a1);
    reg.register(a2);
    const resolved = await reg.resolve({ projectRoot: '/tmp' });
    expect(resolved.id).toBe('a1');
  });

  it('5. duplicate adapter ID+version rejected', () => {
    const reg = new ProjectAdapterRegistry();
    reg.register(new JsonProjectAdapter());
    expect(() => reg.register(new JsonProjectAdapter())).toThrow('already registered');
  });

  it('6. list returns all registered adapters', () => {
    const reg = new ProjectAdapterRegistry();
    reg.register(new JsonProjectAdapter());
    expect(reg.list()).toHaveLength(1);
    expect(reg.list()[0]!.id).toBe('json-project-adapter');
  });

  it('7. higher score wins', async () => {
    const reg = new ProjectAdapterRegistry();
    const low: ProjectAdapter = {
      id: 'low', version: '1.0.0',
      canLoad: async () => ({ supported: true, score: 1, reasons: [] }),
      load: async () => ({} as ProjectExecutionProfile),
    };
    const high: ProjectAdapter = {
      id: 'high', version: '1.0.0',
      canLoad: async () => ({ supported: true, score: 10, reasons: [] }),
      load: async () => ({} as ProjectExecutionProfile),
    };
    reg.register(low);
    reg.register(high);
    const resolved = await reg.resolve({ projectRoot: '/tmp' });
    expect(resolved.id).toBe('high');
  });
});

// ---- Path Safety ----

describe('Path Safety', () => {
  it('11. config inside root is allowed', () => {
    expect(() => assertWithinRoot('/project/tirai.project.json', '/project')).not.toThrow();
  });

  it('12. nested path inside root is allowed', () => {
    expect(() => assertWithinRoot('/project/tirai/ui-catalog.json', '/project')).not.toThrow();
  });

  it('13. config path escape rejected', () => {
    expect(() => assertWithinRoot('/etc/passwd', '/project')).toThrow('Path escapes project root');
  });

  it('14. relative path escape rejected', () => {
    expect(() => assertWithinRoot('/project/../../../etc/passwd', '/project')).toThrow();
  });

  it('15. same path as root is allowed', () => {
    expect(() => assertWithinRoot('/project', '/project')).not.toThrow();
  });
});

// ---- JSON Adapter canLoad ----

describe('JsonProjectAdapter canLoad', () => {
  it('125. canLoad returns supported when config exists', async () => {
    const adapter = new JsonProjectAdapter();
    const match = await adapter.canLoad({ projectRoot: SAMPLE });
    expect(match.supported).toBe(true);
    expect(match.score).toBeGreaterThan(0);
  });

  it('125b. canLoad returns unsupported when config missing', async () => {
    const adapter = new JsonProjectAdapter();
    const match = await adapter.canLoad({ projectRoot: '/nonexistent' });
    expect(match.supported).toBe(false);
  });
});

// ---- Config Loading ----

describe('Config Loading', () => {
  it('6. valid config loads', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    expect(profile.schemaVersion).toBe('1.0');
    expect(profile.project.id).toBe('sample-app');
  });

  it('7. missing config throws', async () => {
    const adapter = new JsonProjectAdapter();
    await expect(
      adapter.load({ projectRoot: '/nonexistent' }),
    ).rejects.toThrow();
  });

  it('8. malformed JSON throws PROJECT_CONFIG_INVALID', async () => {
    const tmpDir = resolve(FIXTURES, '_tmp_malformed');
    await mkdir(tmpDir, { recursive: true });
    await writeFile(resolve(tmpDir, 'tirai.project.json'), '{bad json', 'utf-8');
    const adapter = new JsonProjectAdapter();
    await expect(
      adapter.load({ projectRoot: tmpDir }),
    ).rejects.toThrow('not valid JSON');
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('9. unsupported version throws PROJECT_SCHEMA_UNSUPPORTED', async () => {
    const tmpDir = resolve(FIXTURES, '_tmp_version');
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      resolve(tmpDir, 'tirai.project.json'),
      JSON.stringify({ schemaVersion: '99.0', project: { id: 'x', name: 'x' } }),
      'utf-8',
    );
    const adapter = new JsonProjectAdapter();
    await expect(
      adapter.load({ projectRoot: tmpDir }),
    ).rejects.toThrow('Unsupported schemaVersion');
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('10. missing project.id throws', async () => {
    const tmpDir = resolve(FIXTURES, '_tmp_noid');
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      resolve(tmpDir, 'tirai.project.json'),
      JSON.stringify({ schemaVersion: '1.0', project: { name: 'x' } }),
      'utf-8',
    );
    const adapter = new JsonProjectAdapter();
    await expect(
      adapter.load({ projectRoot: tmpDir }),
    ).rejects.toThrow('project.id must be a non-empty string');
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('24. missing environment throws PROJECT_ENVIRONMENT_NOT_FOUND', async () => {
    const adapter = new JsonProjectAdapter();
    await expect(
      adapter.load({ projectRoot: SAMPLE }, { environment: 'nonexistent' }),
    ).rejects.toThrow('not found');
  });
});

// ---- Project Identity ----

describe('Project Identity', () => {
  it('16. valid identity', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    expect(profile.project.id).toBe('sample-app');
    expect(profile.project.name).toBe('Sample App');
    expect(profile.project.adapterId).toBe('json-project-adapter');
  });

  it('17. missing project throws', async () => {
    const tmpDir = resolve(FIXTURES, '_tmp_noproject');
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      resolve(tmpDir, 'tirai.project.json'),
      JSON.stringify({ schemaVersion: '1.0' }),
      'utf-8',
    );
    const adapter = new JsonProjectAdapter();
    await expect(adapter.load({ projectRoot: tmpDir })).rejects.toThrow();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('19. adapter metadata present', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    expect(profile.project.adapterVersion).toBe('1.0.0');
    expect(profile.project.root).toBe(SAMPLE);
  });
});

// ---- Environment ----

describe('Environment', () => {
  it('20. local environment', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    expect(profile.environment.id).toBe('local');
    expect(profile.environment.safety).toBe('isolated');
  });

  it('21. test environment', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'test' });
    expect(profile.environment.id).toBe('test');
    expect(profile.environment.safety).toBe('shared-nonprod');
  });

  it('23. production environment', async () => {
    const tmpDir = resolve(FIXTURES, '_tmp_prod');
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      resolve(tmpDir, 'tirai.project.json'),
      JSON.stringify({
        schemaVersion: '1.0',
        project: { id: 'prod', name: 'Prod' },
        environments: { prod: { name: 'Production', safety: 'production' } },
      }),
      'utf-8',
    );
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: tmpDir }, { environment: 'prod' });
    expect(profile.environment.safety).toBe('production');
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('25. unknown safety', async () => {
    const tmpDir = resolve(FIXTURES, '_tmp_unknown_safety');
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      resolve(tmpDir, 'tirai.project.json'),
      JSON.stringify({
        schemaVersion: '1.0',
        project: { id: 'x', name: 'X' },
        environments: { dev: { name: 'Dev', safety: 'unknown' } },
      }),
      'utf-8',
    );
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: tmpDir }, { environment: 'dev' });
    expect(profile.environment.safety).toBe('unknown');
    await rm(tmpDir, { recursive: true, force: true });
  });
});
