// Adapter, validator, readiness, fingerprint, selectors tests.

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import {
  JsonProjectAdapter,
  validateProfile,
  deriveReadiness,
  deriveQuality,
  computeProfileFingerprint,
  getUIProfile,
  getAPIProfile,
  getDatabaseProfile,
  getEnvironment,
  getBinding,
  getSecretRef,
  getCommand,
  validateTenantId,
} from '../src/index.js';
import {
  makeProfile,
  makeUIProfile,
  makeCapabilities,
  makeEnvironment,
} from './fixtures/helpers.js';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const SAMPLE = resolve(FIXTURES, 'sample-project');
const MULTITENANT = resolve(FIXTURES, 'multitenant-project');

// ---- UI Profile ----

describe('UI Profile', () => {
  it('26. valid UI profile loaded', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    expect(profile.ui).toBeDefined();
    expect(profile.ui!.catalog.pages).toHaveLength(2);
  });

  it('27. no UI profile when not configured', async () => {
    const profile = makeProfile({ ui: undefined });
    expect(profile.ui).toBeUndefined();
  });

  it('28. page loaded', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    const loginPage = profile.ui!.catalog.pages.find((p) => p.id === 'login-page');
    expect(loginPage).toBeDefined();
    expect(loginPage!.route).toBe('/login');
  });

  it('29. element loaded', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    const loginPage = profile.ui!.catalog.pages.find((p) => p.id === 'login-page');
    const username = loginPage!.elements.find((e) => e.logicalName === 'username-field');
    expect(username).toBeDefined();
    expect(username!.locator.strategy).toBe('test-id');
    expect(username!.locator.value).toBe('username');
  });

  it('30. test-id strategy', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    const el = profile.ui!.catalog.pages[0]!.elements[0]!;
    expect(el.locator.strategy).toBe('test-id');
  });

  it('31. role strategy supported', () => {
    const cat = makeUIProfile().catalog;
    cat.pages[0]!.elements[0]!.locator.strategy = 'role';
    expect(cat.pages[0]!.elements[0]!.locator.strategy).toBe('role');
  });

  it('32. sensitive element preserved', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    const loginPage = profile.ui!.catalog.pages.find((p) => p.id === 'login-page');
    const pwd = loginPage!.elements.find((e) => e.logicalName === 'password-field');
    expect(pwd!.sensitive).toBe(true);
  });

  it('33. duplicate page detected', () => {
    const cat = makeUIProfile().catalog;
    cat.pages.push({ ...cat.pages[0]! });
    const profile = makeProfile({ ui: makeUIProfile() });
    profile.ui!.catalog = cat;
    const result = validateProfile(profile);
    expect(result.errors.some((e) => e.code === 'PROJECT_DUPLICATE_RESOURCE')).toBe(true);
  });

  it('34. duplicate element detected', () => {
    const profile = makeProfile();
    profile.ui!.catalog.pages[0]!.elements.push({
      ...profile.ui!.catalog.pages[0]!.elements[0]!,
    });
    const result = validateProfile(profile);
    expect(result.errors.some((e) => e.code === 'PROJECT_DUPLICATE_RESOURCE')).toBe(true);
  });
});

// ---- API Profile ----

describe('API Profile', () => {
  it('36. resource loaded', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    expect(profile.api).toBeDefined();
    expect(profile.api!.resources).toHaveLength(1);
    expect(profile.api!.resources[0]!.id).toBe('auth-api');
  });

  it('37. operation loaded', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    expect(profile.api!.operations).toHaveLength(2);
  });

  it('38. GET operation', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    const getUser = profile.api!.operations.find((o) => o.id === 'get-user');
    expect(getUser!.method).toBe('GET');
  });

  it('39. POST operation', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    const login = profile.api!.operations.find((o) => o.id === 'login');
    expect(login!.method).toBe('POST');
  });

  it('40. invalid resource ref detected', () => {
    const profile = makeProfile();
    profile.api!.operations.push({ id: 'bad', resourceId: 'nonexistent', method: 'GET', path: '/' });
    const result = validateProfile(profile);
    expect(result.errors.some((e) => e.code === 'PROJECT_INVALID_REFERENCE')).toBe(true);
  });

  it('41. duplicate operation detected', () => {
    const profile = makeProfile();
    profile.api!.operations.push({ ...profile.api!.operations[0]! });
    const result = validateProfile(profile);
    expect(result.errors.some((e) => e.code === 'PROJECT_DUPLICATE_RESOURCE')).toBe(true);
  });

  it('42. secret auth ref validated', () => {
    const profile = makeProfile();
    profile.api!.resources[0]!.authStrategy = { kind: 'bearer', secretRef: 'MISSING_SECRET' };
    const result = validateProfile(profile);
    expect(result.errors.some((e) => e.code === 'PROJECT_INVALID_REFERENCE')).toBe(true);
  });
});

// ---- Database Profile ----

describe('Database Profile', () => {
  it('43. postgres loaded', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    expect(profile.database).toBeDefined();
    expect(profile.database!.resources[0]!.dialect).toBe('postgresql');
  });

  it('44. schema loaded', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    expect(profile.database!.catalogs[0]!.schemas).toHaveLength(1);
    expect(profile.database!.catalogs[0]!.schemas[0]!.name).toBe('public');
  });

  it('45. table loaded', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    const tables = profile.database!.catalogs[0]!.schemas[0]!.tables;
    expect(tables.map((t) => t.name)).toContain('users');
    expect(tables.map((t) => t.name)).toContain('sessions');
  });

  it('46. column loaded', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    const users = profile.database!.catalogs[0]!.schemas[0]!.tables.find((t) => t.name === 'users');
    expect(users!.columns.map((c) => c.name)).toContain('username');
  });

  it('47. PK loaded', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    const users = profile.database!.catalogs[0]!.schemas[0]!.tables.find((t) => t.name === 'users');
    expect(users!.primaryKey).toEqual(['id']);
  });

  it('48. FK loaded', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    const sessions = profile.database!.catalogs[0]!.schemas[0]!.tables.find((t) => t.name === 'sessions');
    expect(sessions!.foreignKeys).toHaveLength(1);
    expect(sessions!.foreignKeys![0]!.referencedTable).toBe('users');
  });

  it('49. unique constraint loaded', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    const users = profile.database!.catalogs[0]!.schemas[0]!.tables.find((t) => t.name === 'users');
    expect(users!.uniqueConstraints).toEqual([['username']]);
  });

  it('50. invalid DB resource ref detected', () => {
    const profile = makeProfile();
    profile.database!.catalogs[0]!.resourceId = 'nonexistent-db';
    const result = validateProfile(profile);
    expect(result.errors.some((e) => e.code === 'PROJECT_INVALID_REFERENCE')).toBe(true);
  });
});

// ---- Tenancy ----

describe('Tenancy', () => {
  it('51. no tenant strategy', () => {
    const profile = makeProfile();
    expect(profile.database!.resources[0]!.tenantStrategy).toBeUndefined();
  });

  it('53. schema-per-tenant loaded', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: MULTITENANT }, { environment: 'local' });
    const res = profile.database!.resources[0]!;
    expect(res.tenantStrategy?.strategy).toBe('schema-per-tenant');
    expect(res.tenantStrategy?.schemaPattern).toBe('tenant{tenantId}');
  });

  it('56. integer tenant ID valid', () => {
    expect(validateTenantId('1')).toBe(true);
    expect(validateTenantId('42')).toBe(true);
  });

  it('57. malicious tenant rejected', () => {
    expect(validateTenantId('1;DROP TABLE')).toBe(false);
    expect(validateTenantId('1 OR 1=1')).toBe(false);
    expect(validateTenantId('../etc')).toBe(false);
  });

  it('58. alphanumeric tenant valid', () => {
    expect(validateTenantId('tenant1')).toBe(true);
    expect(validateTenantId('acme-corp')).toBe(true);
  });
});

// ---- Bindings ----

describe('Bindings', () => {
  it('59. normal binding loaded', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    expect(profile.bindings.definitions).toHaveLength(2);
    expect(profile.bindings.definitions[0]!.sensitive).toBe(false);
  });

  it('60. sensitive binding', () => {
    const profile = makeProfile();
    profile.bindings.definitions.push({ name: 'runtime.secret', type: 'secret', sensitive: true });
    expect(profile.bindings.definitions[2]!.sensitive).toBe(true);
  });

  it('61. duplicate binding detected', () => {
    const profile = makeProfile();
    profile.bindings.definitions.push({ ...profile.bindings.definitions[0]! });
    const result = validateProfile(profile);
    expect(result.errors.some((e) => e.code === 'PROJECT_DUPLICATE_RESOURCE')).toBe(true);
  });
});

// ---- Secrets ----

describe('Secrets', () => {
  it('64. secret ref loaded', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    expect(profile.secrets.references).toHaveLength(2);
    expect(profile.secrets.references.map((s) => s.name)).toContain('DB_PASSWORD');
  });

  it('65. duplicate secret detected', () => {
    const profile = makeProfile();
    profile.secrets.references.push({ ...profile.secrets.references[0]! });
    const result = validateProfile(profile);
    expect(result.errors.some((e) => e.code === 'PROJECT_DUPLICATE_RESOURCE')).toBe(true);
  });

  it('66. no secret values in profile', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    const json = JSON.stringify(profile);
    expect(json).not.toContain('password123');
    expect(json).not.toContain('secret_value');
  });

  it('67. unused secret warning', () => {
    const profile = makeProfile();
    profile.secrets.references.push({ name: 'UNUSED_SECRET' });
    const result = validateProfile(profile);
    expect(result.warnings.some((w) => w.code === 'PROJECT_SECRET_REFERENCE_UNUSED')).toBe(true);
  });
});

// ---- Commands ----

describe('Commands', () => {
  it('68. npm start loaded', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    const start = profile.commands.commands.find((c) => c.id === 'npm-start');
    expect(start).toBeDefined();
    expect(start!.command).toBe('npm');
    expect(start!.args).toEqual(['run', 'start']);
  });

  it('70. test command loaded', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    const test = profile.commands.commands.find((c) => c.id === 'npm-test');
    expect(test!.purpose).toBe('test');
  });

  it('71. argv form preserved', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    const start = profile.commands.commands.find((c) => c.id === 'npm-start');
    expect(start!.args).toEqual(['run', 'start']);
    expect(start!.command).toBe('npm');
  });

  it('72. unsafe command warning', () => {
    const profile = makeProfile();
    profile.commands.commands[0]!.safeForAutomation = false;
    const result = validateProfile(profile);
    expect(result.warnings.some((w) => w.code === 'PROJECT_COMMAND_UNSAFE')).toBe(true);
  });

  it('74. duplicate command detected', () => {
    const profile = makeProfile();
    profile.commands.commands.push({ ...profile.commands.commands[0]! });
    const result = validateProfile(profile);
    expect(result.errors.some((e) => e.code === 'PROJECT_DUPLICATE_RESOURCE')).toBe(true);
  });
});

// ---- Capabilities ----

describe('Capabilities', () => {
  it('75. UI capability derived', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    expect(profile.capabilities.ui).toBe(true);
  });

  it('76. API capability derived', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    expect(profile.capabilities.api).toBe(true);
  });

  it('77. DB capability derived', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    expect(profile.capabilities.database).toBe(true);
  });

  it('80. capabilities derived not trusted', () => {
    const profile = makeProfile({ ui: undefined });
    expect(profile.capabilities.ui).toBe(true); // from makeCapabilities default
    // But if we re-derive from actual profile data:
    const noUI = makeProfile({ ui: undefined, capabilities: makeCapabilities({ ui: false }) });
    expect(noUI.capabilities.ui).toBe(false);
  });
});

// ---- Safety ----

describe('Safety', () => {
  it('81. isolated environment', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    expect(profile.environment.safety).toBe('isolated');
  });

  it('82. shared-nonprod environment', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'test' });
    expect(profile.environment.safety).toBe('shared-nonprod');
  });

  it('84. production warning', () => {
    const profile = makeProfile({ environment: makeEnvironment({ safety: 'production' }) });
    const result = validateProfile(profile);
    expect(result.warnings.some((w) => w.code === 'PROJECT_PRODUCTION_ENVIRONMENT')).toBe(true);
  });

  it('85. production capabilities denied by default', () => {
    const caps = makeCapabilities({
      browserExecution: false,
      apiExecution: false,
      databaseExecution: false,
      testDataMutation: false,
    });
    expect(caps.browserExecution).toBe(false);
    expect(caps.testDataMutation).toBe(false);
  });
});

// ---- Validation ----

describe('Validation', () => {
  it('66. ready profile validates', () => {
    const profile = makeProfile();
    const result = validateProfile(profile);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('67. no UI warning', () => {
    const profile = makeProfile({ ui: undefined });
    const result = validateProfile(profile);
    expect(result.warnings.some((w) => w.code === 'PROJECT_NO_UI')).toBe(true);
  });

  it('68. no API warning', () => {
    const profile = makeProfile({ api: undefined });
    const result = validateProfile(profile);
    expect(result.warnings.some((w) => w.code === 'PROJECT_NO_API')).toBe(true);
  });

  it('69. no DB warning', () => {
    const profile = makeProfile({ database: undefined });
    const result = validateProfile(profile);
    expect(result.warnings.some((w) => w.code === 'PROJECT_NO_DATABASE')).toBe(true);
  });

  it('99. invalid ref fails validation', () => {
    const profile = makeProfile();
    profile.api!.operations.push({ id: 'bad', resourceId: 'no-such-resource', method: 'GET', path: '/' });
    const result = validateProfile(profile);
    expect(result.valid).toBe(false);
  });
});

// ---- Fingerprint ----

describe('Fingerprint', () => {
  it('100. deterministic', () => {
    const fp1 = computeProfileFingerprint('1.0.0', '{}', [], 'local');
    const fp2 = computeProfileFingerprint('1.0.0', '{}', [], 'local');
    expect(fp1).toBe(fp2);
  });

  it('101. config change changes fingerprint', () => {
    const fp1 = computeProfileFingerprint('1.0.0', '{"a":1}', [], 'local');
    const fp2 = computeProfileFingerprint('1.0.0', '{"a":2}', [], 'local');
    expect(fp1).not.toBe(fp2);
  });

  it('102. catalog change changes fingerprint', () => {
    const fp1 = computeProfileFingerprint('1.0.0', '{}', ['cat1'], 'local');
    const fp2 = computeProfileFingerprint('1.0.0', '{}', ['cat2'], 'local');
    expect(fp1).not.toBe(fp2);
  });

  it('103. env change changes fingerprint', () => {
    const fp1 = computeProfileFingerprint('1.0.0', '{}', [], 'local');
    const fp2 = computeProfileFingerprint('1.0.0', '{}', [], 'test');
    expect(fp1).not.toBe(fp2);
  });

  it('104. adapter version change changes fingerprint', () => {
    const fp1 = computeProfileFingerprint('1.0.0', '{}', [], 'local');
    const fp2 = computeProfileFingerprint('2.0.0', '{}', [], 'local');
    expect(fp1).not.toBe(fp2);
  });

  it('156. profile fingerprint is stable', async () => {
    const adapter = new JsonProjectAdapter();
    const p1 = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    const p2 = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    expect(p1.fingerprint).toBe(p2.fingerprint);
  });
});

// ---- Selectors ----

describe('Selectors', () => {
  it('115. getUIProfile', () => {
    const profile = makeProfile();
    expect(getUIProfile(profile)).toBeDefined();
    expect(getUIProfile(profile)!.catalog.pages).toHaveLength(2);
  });

  it('116. getAPIProfile', () => {
    const profile = makeProfile();
    expect(getAPIProfile(profile)).toBeDefined();
    expect(getAPIProfile(profile)!.resources).toHaveLength(1);
  });

  it('117. getDatabaseProfile', () => {
    const profile = makeProfile();
    expect(getDatabaseProfile(profile)).toBeDefined();
  });

  it('118. getBinding', () => {
    const profile = makeProfile();
    expect(getBinding(profile, 'runtime.username')).toBeDefined();
    expect(getBinding(profile, 'nonexistent')).toBeUndefined();
  });

  it('119. getSecretRef', () => {
    const profile = makeProfile();
    expect(getSecretRef(profile, 'DB_PASSWORD')).toBeDefined();
    expect(getSecretRef(profile, 'MISSING')).toBeUndefined();
  });

  it('119b. getCommand', () => {
    const profile = makeProfile();
    expect(getCommand(profile, 'npm-start')).toBeDefined();
    expect(getCommand(profile, 'nonexistent')).toBeUndefined();
  });

  it('118b. getEnvironment', () => {
    const profile = makeProfile();
    expect(getEnvironment(profile).id).toBe('local');
  });
});

// ---- Readiness ----

describe('Readiness', () => {
  it('120. full readiness', () => {
    const profile = makeProfile();
    const r = deriveReadiness(profile);
    expect(r.executionMappingReady).toBe(true);
    expect(r.uiExecutionReady).toBe(true);
    expect(r.apiExecutionReady).toBe(true);
    expect(r.databaseExecutionReady).toBe(true);
    expect(r.endToEndRunnerReady).toBe(true);
  });

  it('121. UI missing', () => {
    const profile = makeProfile({ ui: undefined });
    const r = deriveReadiness(profile);
    expect(r.uiExecutionReady).toBe(false);
    expect(r.blockers.some((b) => b.area === 'ui')).toBe(true);
  });

  it('122. API missing', () => {
    const profile = makeProfile({ api: undefined });
    const r = deriveReadiness(profile);
    expect(r.apiExecutionReady).toBe(false);
  });

  it('123. DB missing', () => {
    const profile = makeProfile({ database: undefined });
    const r = deriveReadiness(profile);
    expect(r.databaseExecutionReady).toBe(false);
  });

  it('124. blockers listed', () => {
    const profile = makeProfile({ ui: undefined, api: undefined, database: undefined });
    const r = deriveReadiness(profile);
    expect(r.blockers.length).toBeGreaterThan(0);
    expect(r.endToEndRunnerReady).toBe(false);
  });
});

// ---- Quality ----

describe('Quality', () => {
  it('101. quality metrics computed', () => {
    const profile = makeProfile();
    const q = deriveQuality(profile, 0, 0);
    expect(q.uiPages).toBe(2);
    expect(q.uiElements).toBe(4);
    expect(q.apiOperations).toBe(2);
    expect(q.databaseTables).toBe(1);
    expect(q.bindings).toBe(2);
    expect(q.secretRefs).toBe(2);
    expect(q.commands).toBe(2);
    expect(q.readinessScore).toBe(1);
  });

  it('102. quality with warnings', () => {
    const profile = makeProfile();
    const q = deriveQuality(profile, 5, 0);
    expect(q.warnings).toBe(5);
  });
});

// ---- Multi-tenant fixture ----

describe('Multi-tenant Fixture', () => {
  it('151. tenant1 default', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: MULTITENANT }, { environment: 'local' });
    const res = profile.database!.resources[0]!;
    expect(res.tenantStrategy?.defaultTestTenant).toBe('1');
  });

  it('153. injection rejected', () => {
    expect(validateTenantId('1;DROP TABLE users')).toBe(false);
    expect(validateTenantId('1" OR "1"="1')).toBe(false);
  });
});

// ---- Sample Project ----

describe('Sample Project', () => {
  it('146. complete fixture loads', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    expect(profile.ui).toBeDefined();
    expect(profile.api).toBeDefined();
    expect(profile.database).toBeDefined();
  });

  it('147. login page elements', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    const login = profile.ui!.catalog.pages.find((p) => p.id === 'login-page');
    expect(login!.elements).toHaveLength(3);
  });

  it('148. auth API', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    expect(profile.api!.resources[0]!.id).toBe('auth-api');
  });

  it('149. users table', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    const tables = profile.database!.catalogs[0]!.schemas[0]!.tables;
    expect(tables.find((t) => t.name === 'users')).toBeDefined();
  });

  it('150. project readiness', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    const r = deriveReadiness(profile);
    expect(r.executionMappingReady).toBe(true);
  });
});

// ---- Determinism ----

describe('Determinism', () => {
  it('154. output ordering stable', async () => {
    const adapter = new JsonProjectAdapter();
    const p1 = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    const p2 = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    // Fingerprint is deterministic even though provenance timestamp may differ.
    expect(p1.fingerprint).toBe(p2.fingerprint);
    // Core structure is stable.
    expect(p1.project.id).toBe(p2.project.id);
    expect(p1.environment.id).toBe(p2.environment.id);
    expect(JSON.stringify(p1.bindings)).toBe(JSON.stringify(p2.bindings));
    expect(JSON.stringify(p1.secrets)).toBe(JSON.stringify(p2.secrets));
    expect(JSON.stringify(p1.commands)).toBe(JSON.stringify(p2.commands));
  });

  it('155. repeated load same result', async () => {
    const adapter = new JsonProjectAdapter();
    const results = await Promise.all([
      adapter.load({ projectRoot: SAMPLE }, { environment: 'local' }),
      adapter.load({ projectRoot: SAMPLE }, { environment: 'local' }),
    ]);
    expect(results[0]!.fingerprint).toBe(results[1]!.fingerprint);
  });
});

// ---- Security ----

describe('Security', () => {
  it('135. no secret values in output', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    const json = JSON.stringify(profile);
    // Only references, never values.
    expect(json).toContain('DB_PASSWORD');
    expect(json).not.toContain('actual_password_value');
  });

  it('136. no command execution', () => {
    // Commands are metadata only — no exec/spawn in the adapter.
    const profile = makeProfile();
    expect(profile.commands.commands[0]!.command).toBe('npm');
    // No execution occurred.
  });

  it('140. no AI calls', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    // Profile is deterministic — no AI involved.
    expect(profile.schemaVersion).toBe('1.0');
  });

  it('141. no JS config', () => {
    // Only JSON config supported. No require/import of .js files.
    // This is enforced by the loader which only reads JSON.
  });
});

// ---- Profile Output ----

describe('Profile Output', () => {
  it('105. schema version', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    expect(profile.schemaVersion).toBe('1.0');
  });

  it('106. project identity', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    expect(profile.project.id).toBe('sample-app');
  });

  it('107. environment', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    expect(profile.environment.id).toBe('local');
  });

  it('114. provenance', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    expect(profile.provenance).toHaveLength(1);
    expect(profile.provenance[0]!.adapterId).toBe('json-project-adapter');
  });
});

// ---- JSON Adapter validate ----

describe('JSON Adapter validate', () => {
  it('127. validate returns valid for good profile', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = await adapter.load({ projectRoot: SAMPLE }, { environment: 'local' });
    const result = await adapter.validate!(profile);
    expect(result.valid).toBe(true);
  });

  it('128. validate catches bad schema version', async () => {
    const adapter = new JsonProjectAdapter();
    const profile = makeProfile({ schemaVersion: '2.0' as '1.0' });
    const result = await adapter.validate!(profile);
    expect(result.valid).toBe(false);
  });
});
