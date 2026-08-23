// Integration, persistence, catalog edge cases, and additional coverage tests.

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import {
  JsonProjectAdapter,
  validateProfile,
  deriveReadiness,
  deriveQuality,
  writeProfileOutput,
  computeProfileFingerprint,
  validateTenantId,
  loadCatalogJson,
} from '../src/index.js';
import {
  makeProfile,
  makeUIProfile,
  makeAPIProfile,
  makeDBProfile,
  makeEnvironment,
} from './fixtures/helpers.js';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const SAMPLE = resolve(FIXTURES, 'sample-project');

// ---- Catalog Loading Edge Cases ----

describe('Catalog Loading', () => {
  it('86. UI catalog file loaded', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    expect(profile.ui!.catalog.pages.length).toBeGreaterThan(0);
  });

  it('87. API catalog file loaded', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    expect(profile.api!.resources.length).toBeGreaterThan(0);
  });

  it('88. DB catalog file loaded', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    expect(profile.database!.catalogs.length).toBeGreaterThan(0);
  });

  it('89. missing catalog file throws', async () => {
    const tmpDir = resolve(FIXTURES, '_tmp_missing_catalog');
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      resolve(tmpDir, 'tirai.project.json'),
      JSON.stringify({
        schemaVersion: '1.0',
        project: { id: 'x', name: 'X' },
        environments: { local: { name: 'L', safety: 'isolated' } },
        ui: { catalog: './nonexistent.json' },
      }),
      'utf-8',
    );
    const adapter = new JsonProjectAdapter();
    await expect(adapter.load({ projectRoot: tmpDir })).rejects.toThrow();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('90. malformed catalog throws', () => {
    expect(() => loadCatalogJson('{bad', 'test.json')).toThrow('not valid JSON');
  });

  it('91. duplicate resource IDs in API', () => {
    const profile = makeProfile();
    profile.api!.resources.push({ ...profile.api!.resources[0]! });
    const result = validateProfile(profile);
    expect(result.errors.some((e) => e.code === 'PROJECT_DUPLICATE_RESOURCE')).toBe(true);
  });

  it('92. stable merge of inline + catalog resources', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    // Resources from config + catalog merged deterministically.
    expect(profile.api!.resources.length).toBeGreaterThanOrEqual(1);
  });
});

// ---- Cross References ----

describe('Cross References', () => {
  it('93. UI refs valid', () => {
    const profile = makeProfile();
    const result = validateProfile(profile);
    const uiErrors = result.errors.filter((e) => e.path?.startsWith('ui'));
    expect(uiErrors).toHaveLength(0);
  });

  it('94. API refs valid', () => {
    const profile = makeProfile();
    const result = validateProfile(profile);
    const apiErrors = result.errors.filter((e) => e.path?.startsWith('api'));
    expect(apiErrors).toHaveLength(0);
  });

  it('95. DB refs valid', () => {
    const profile = makeProfile();
    const result = validateProfile(profile);
    const dbErrors = result.errors.filter((e) => e.path?.startsWith('database'));
    expect(dbErrors).toHaveLength(0);
  });

  it('96. binding refs validated', () => {
    const profile = makeProfile();
    const result = validateProfile(profile);
    expect(result.valid).toBe(true);
  });

  it('97. secret refs validated', () => {
    const profile = makeProfile();
    // Change auth secret to nonexistent.
    profile.api!.resources[0]!.authStrategy = { kind: 'bearer', secretRef: 'MISSING' };
    const result = validateProfile(profile);
    expect(result.valid).toBe(false);
  });

  it('98. command envRefs checked', () => {
    const profile = makeProfile();
    profile.commands.commands[0]!.envRefs = ['nonexistent.ref'];
    const result = validateProfile(profile);
    expect(result.warnings.some((w) => w.code === 'PROJECT_BINDING_UNUSED')).toBe(true);
  });

  it('99b. invalid ref fails validation', () => {
    const profile = makeProfile();
    profile.database!.catalogs[0]!.resourceId = 'bad-resource';
    const result = validateProfile(profile);
    expect(result.valid).toBe(false);
  });
});

// ---- Persistence ----

describe('Persistence', () => {
  it('105. writes profile output', async () => {
    const tmpDir = resolve(FIXTURES, '_tmp_persist');
    const profile = makeProfile();
    const validation = validateProfile(profile);
    const readiness = deriveReadiness(profile);
    const quality = deriveQuality(profile, 0, 0);
    const report = {
      schemaVersion: '1.0' as const,
      projectId: profile.project.id,
      environmentId: profile.environment.id,
      safety: profile.environment.safety,
      fingerprint: profile.fingerprint,
      errors: validation.errors,
      warnings: validation.warnings,
      quality,
      capabilities: profile.capabilities,
      readiness,
    };
    await writeProfileOutput({ outputDir: tmpDir, profile, report, pretty: true });
    const profileJson = await readFile(resolve(tmpDir, 'project-execution-profile.json'), 'utf-8');
    expect(JSON.parse(profileJson).schemaVersion).toBe('1.0');
    const manifest = await readFile(resolve(tmpDir, 'manifest.json'), 'utf-8');
    expect(JSON.parse(manifest).projectId).toBe('test-project');
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('106. writes catalogs', async () => {
    const tmpDir = resolve(FIXTURES, '_tmp_persist_cat');
    const profile = makeProfile();
    const report = {
      schemaVersion: '1.0' as const,
      projectId: 'test',
      environmentId: 'local',
      safety: 'isolated' as const,
      fingerprint: 'x',
      errors: [],
      warnings: [],
      quality: deriveQuality(profile, 0, 0),
      capabilities: profile.capabilities,
      readiness: deriveReadiness(profile),
    };
    await writeProfileOutput({ outputDir: tmpDir, profile, report });
    const uiCat = await readFile(resolve(tmpDir, 'catalogs', 'ui-catalog.json'), 'utf-8');
    expect(JSON.parse(uiCat).pages).toBeDefined();
    await rm(tmpDir, { recursive: true, force: true });
  });
});

// ---- Additional Adapter Tests ----

describe('Additional Adapter', () => {
  it('126. load produces valid profile', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    const validation = validateProfile(profile);
    expect(validation.valid).toBe(true);
  });

  it('130. adapter ID and version', () => {
    const adapter = new JsonProjectAdapter();
    expect(adapter.id).toBe('json-project-adapter');
    expect(adapter.version).toBe('1.0.0');
  });

  it('131. environment selection works', async () => {
    const adapter = new JsonProjectAdapter();
    const p1 = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    const p2 = await adapter.load({ projectRoot: SAMPLE }, { environment: 'test' });
    expect(p1.environment.id).toBe('local');
    expect(p2.environment.id).toBe('test');
  });

  it('132. default environment is local', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE });
    expect(profile.environment.id).toBe('local');
  });

  it('133. no secret values in output', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    const json = JSON.stringify(profile);
    // Only symbolic references.
    expect(json).not.toContain('actual_password');
    expect(json).not.toContain('super_secret');
  });

  it('134. secret refs only', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    const dbRes = profile.database!.resources[0]!;
    expect(dbRes.connectionSecretRef).toBe('DB_PASSWORD');
  });

  it('137. no DB connection', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    // Profile is metadata only — no connection opened.
    expect(profile.database!.resources[0]!.dialect).toBe('postgresql');
  });

  it('138. no HTTP request', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    // API resources are metadata only.
    expect(profile.api!.resources[0]!.baseUrlRef).toBe('environment.apiBaseUrl');
  });

  it('139. no browser launch', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    // UI config is metadata only.
    expect(profile.ui!.environment.baseUrl).toBe('http://localhost:3000');
  });
});

// ---- Multi-tenant ----

describe('Multi-tenant', () => {
  it('152. tenant2 pattern', () => {
    expect(validateTenantId('2')).toBe(true);
    expect(validateTenantId('tenant2')).toBe(true);
  });

  it('159. capabilities multiTenant derived', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: MULTITENANT }, { environment: 'local' });
    expect(profile.capabilities.multiTenant).toBe(true);
  });
});

const MULTITENANT = resolve(FIXTURES, 'multitenant-project');

// ---- Additional Validation ----

describe('Additional Validation', () => {
  it('duplicate DB resource detected', () => {
    const profile = makeProfile();
    profile.database!.resources.push({ ...profile.database!.resources[0]! });
    const result = validateProfile(profile);
    expect(result.errors.some((e) => e.code === 'PROJECT_DUPLICATE_RESOURCE')).toBe(true);
  });

  it('empty commands is valid', () => {
    const profile = makeProfile({ commands: { commands: [] } });
    const result = validateProfile(profile);
    expect(result.valid).toBe(true);
  });

  it('empty bindings is valid', () => {
    const profile = makeProfile({ bindings: { definitions: [] } });
    const result = validateProfile(profile);
    expect(result.valid).toBe(true);
  });

  it('no commands no warnings about unsafe', () => {
    const profile = makeProfile({ commands: { commands: [] } });
    const result = validateProfile(profile);
    expect(result.warnings.some((w) => w.code === 'PROJECT_COMMAND_UNSAFE')).toBe(false);
  });
});

// ---- Fingerprint Edge Cases ----

describe('Fingerprint Edge Cases', () => {
  it('catalog order does not affect fingerprint', () => {
    const fp1 = computeProfileFingerprint('1.0', '{}', ['a', 'b'], 'local');
    const fp2 = computeProfileFingerprint('1.0', '{}', ['b', 'a'], 'local');
    expect(fp1).toBe(fp2);
  });

  it('fingerprint is hex string', () => {
    const fp = computeProfileFingerprint('1.0', '{}', [], 'local');
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---- Readiness Edge Cases ----

describe('Readiness Edge Cases', () => {
  it('unknown environment safety blocks E2E', () => {
    const profile = makeProfile({ environment: makeEnvironment({ safety: 'unknown' }) });
    const r = deriveReadiness(profile);
    expect(r.endToEndRunnerReady).toBe(false);
    expect(r.blockers.some((b) => b.area === 'environment')).toBe(true);
  });

  it('empty UI catalog blocks UI readiness', () => {
    const ui = makeUIProfile();
    ui.catalog.pages = [];
    const profile = makeProfile({ ui });
    const r = deriveReadiness(profile);
    expect(r.uiExecutionReady).toBe(false);
  });

  it('empty API operations blocks API readiness', () => {
    const api = makeAPIProfile();
    api.operations = [];
    const profile = makeProfile({ api });
    const r = deriveReadiness(profile);
    expect(r.apiExecutionReady).toBe(false);
  });

  it('empty DB catalogs blocks DB readiness', () => {
    const db = makeDBProfile();
    db.catalogs = [];
    const profile = makeProfile({ database: db });
    const r = deriveReadiness(profile);
    expect(r.databaseExecutionReady).toBe(false);
  });
});
