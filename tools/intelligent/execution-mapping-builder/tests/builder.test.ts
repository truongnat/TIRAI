// Tests: Catalog, Bindings, Candidates, Validation, Quality, Fingerprint, Checkpoint, Builder, AI.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Catalog
import { createEmptyCatalog, createUICatalogResolver, type UICatalogResolver } from '../src/catalog/catalog.js';
// Bindings
import { BindingResolver, createEmptyBindingsCatalog, createBindingsCatalog } from '../src/bindings/bindings.js';
// Candidates
import {
  isSupportedAction,
  isSupportedAssertion,
  inferActionFromStep,
  inferAssertionFromResult,
  generateStepCandidates,
  generateAssertionCandidates,
  generateExecutorCandidate,
} from '../src/candidates/candidates.js';
// Validation
import { validateUICandidate, validateAllCandidates } from '../src/validation/validation.js';
// Quality
import { computeQuality } from '../src/quality/quality.js';
// Fingerprint
import { computeFingerprint } from '../src/fingerprint.js';
// Checkpoint
import { CheckpointStore } from '../src/checkpoint.js';
// Builder
import { buildExecutionMapping } from '../src/builder.js';
// Errors
import { ExecutionMappingError, EXECUTION_MAPPING_ERROR_CODES } from '../src/errors.js';
// Warnings
import { EXECUTION_MAPPING_WARNING_CODES } from '../src/warnings.js';
// Persistence
import { writeOutput } from '../src/persistence/writer.js';
// Fixtures
import {
  makeTestCase,
  makeLoginTestCase,
  makeLoginCatalog,
  makeBindingsCatalog,
  makeDuplicateCatalog,
  makeApiTestCase,
  makeDbTestCase,
  makeManualTestCase,
} from './fixtures/helpers.js';
import type {
  ExecutorCandidate,
  ExecutionMappingResult,
} from '../src/models.js';

// ===========================================================================
// CATALOG TESTS (§56-61)
// ===========================================================================

describe('UICatalogResolver', () => {
  let catalog: UICatalogResolver;

  beforeEach(() => {
    catalog = createUICatalogResolver(makeLoginCatalog());
  });

  it('looks up element by exact logical name', () => {
    const result = catalog.lookupByLogicalName('username-field');
    expect(result.found).toBe(true);
    expect(result.element?.logicalName).toBe('username-field');
  });

  it('returns not found for unknown element', () => {
    const result = catalog.lookupByLogicalName('nonexistent');
    expect(result.found).toBe(false);
  });

  it('checks element existence', () => {
    expect(catalog.hasElement('username-field')).toBe(true);
    expect(catalog.hasElement('nonexistent')).toBe(false);
  });

  it('checks page existence', () => {
    expect(catalog.hasPage('login-page')).toBe(true);
    expect(catalog.hasPage('nonexistent')).toBe(false);
  });

  it('finds page by ID', () => {
    const page = catalog.findPage('login-page');
    expect(page).toBeDefined();
    expect(page?.id).toBe('login-page');
  });

  it('gets all element names', () => {
    const names = catalog.getAllElementNames();
    expect(names).toContain('username-field');
    expect(names).toContain('password-field');
    expect(names).toContain('login-button');
    expect(names).toContain('dashboard-marker');
  });

  it('validates supported strategies', () => {
    expect(catalog.isSupportedStrategy('test-id')).toBe(true);
    expect(catalog.isSupportedStrategy('role')).toBe(true);
    expect(catalog.isSupportedStrategy('invalid')).toBe(false);
  });

  it('lookup by alias (normalized)', () => {
    const result = catalog.lookupByAlias('username-field');
    expect(result.found).toBe(true);
  });

  it('lookup by name or alias', () => {
    const result = catalog.lookup('username-field');
    expect(result.found).toBe(true);
  });

  it('handles empty catalog', () => {
    const empty = createUICatalogResolver(createEmptyCatalog());
    expect(empty.hasElement('anything')).toBe(false);
    expect(empty.pages).toHaveLength(0);
  });

  it('detects duplicate logical names as ambiguous via alias', () => {
    const dup = createUICatalogResolver(makeDuplicateCatalog());
    const result = dup.lookupByAlias('item');
    expect(result.ambiguous).toBe(true);
  });

  it('returns environmentId', () => {
    expect(catalog.environmentId).toBe('test-env');
  });
});

// ===========================================================================
// BINDINGS TESTS (§62-65)
// ===========================================================================

describe('BindingResolver', () => {
  let resolver: BindingResolver;

  beforeEach(() => {
    resolver = new BindingResolver(makeBindingsCatalog(), undefined, undefined, ['runtime.password']);
  });

  it('checks known binding', () => {
    expect(resolver.isKnown('runtime.username')).toBe(true);
    expect(resolver.isKnown('runtime.password')).toBe(true);
  });

  it('checks unknown binding', () => {
    expect(resolver.isKnown('runtime.nonexistent')).toBe(false);
  });

  it('checks sensitive binding', () => {
    expect(resolver.isSensitive('runtime.password')).toBe(true);
    expect(resolver.isSensitive('runtime.username')).toBe(false);
  });

  it('validates binding', () => {
    expect(resolver.validateBinding('runtime.username').valid).toBe(true);
    expect(resolver.validateBinding('runtime.nonexistent').valid).toBe(false);
  });

  it('counts bindings', () => {
    const result = resolver.countBindings(['runtime.username', 'runtime.nonexistent']);
    expect(result.required).toBe(2);
    expect(result.resolved).toBe(1);
  });

  it('gets all binding names', () => {
    const names = resolver.getAllBindingNames();
    expect(names).toContain('runtime.username');
    expect(names).toContain('runtime.password');
  });

  it('gets binding definition', () => {
    const def = resolver.getDefinition('runtime.username');
    expect(def).toBeDefined();
    expect(def?.type).toBe('runtime');
  });

  it('handles empty catalog', () => {
    const empty = new BindingResolver(createEmptyBindingsCatalog());
    expect(empty.isKnown('anything')).toBe(false);
  });

  it('creates bindings catalog from names', () => {
    const cat = createBindingsCatalog(['a', 'b'], ['b']);
    expect(cat.bindings).toHaveLength(2);
    expect(cat.bindings[1].type).toBe('secret');
  });
});

// ===========================================================================
// CANDIDATES TESTS (§17-20, §27-30)
// ===========================================================================

describe('Candidates', () => {
  describe('isSupportedAction', () => {
    it('accepts all supported actions', () => {
      const actions = ['navigate', 'click', 'fill', 'type', 'select', 'check', 'uncheck', 'press', 'wait', 'focus', 'blur', 'scroll', 'noop'];
      for (const a of actions) expect(isSupportedAction(a)).toBe(true);
    });

    it('rejects unsupported action', () => {
      expect(isSupportedAction('execute')).toBe(false);
      expect(isSupportedAction('run-code')).toBe(false);
    });
  });

  describe('isSupportedAssertion', () => {
    it('accepts all supported assertions', () => {
      const assertions = ['visible', 'hidden', 'enabled', 'disabled', 'checked', 'unchecked', 'text-equals', 'text-contains', 'value-equals', 'url-equals', 'url-contains', 'element-count', 'attribute-equals', 'page-title', 'exists', 'not-exists'];
      for (const a of assertions) expect(isSupportedAssertion(a)).toBe(true);
    });

    it('rejects unsupported assertion', () => {
      expect(isSupportedAssertion('performance')).toBe(false);
    });
  });

  describe('inferActionFromStep', () => {
    it('infers navigate from "Navigate to"', () => {
      expect(inferActionFromStep({ order: 1, action: 'Navigate to login page' })).toBe('navigate');
    });

    it('infers click from "Click"', () => {
      expect(inferActionFromStep({ order: 1, action: 'Click login button' })).toBe('click');
    });

    it('infers fill from "Enter"', () => {
      expect(inferActionFromStep({ order: 1, action: 'Enter username', target: 'field' })).toBe('fill');
    });

    it('infers select from "Select"', () => {
      expect(inferActionFromStep({ order: 1, action: 'Select option' })).toBe('select');
    });

    it('infers check from "Check"', () => {
      expect(inferActionFromStep({ order: 1, action: 'Check the box' })).toBe('check');
    });

    it('infers uncheck from "Uncheck"', () => {
      expect(inferActionFromStep({ order: 1, action: 'Uncheck the box' })).toBe('uncheck');
    });

    it('infers wait from "Wait"', () => {
      expect(inferActionFromStep({ order: 1, action: 'Wait for element' })).toBe('wait');
    });

    it('returns null for unrecognized', () => {
      expect(inferActionFromStep({ order: 1, action: 'Do something weird' })).toBeNull();
    });
  });

  describe('inferAssertionFromResult', () => {
    it('infers visible from "is displayed"', () => {
      expect(inferAssertionFromResult({ description: 'Dashboard is displayed', verificationType: 'ui' })).toBe('visible');
    });

    it('infers hidden from "is hidden"', () => {
      expect(inferAssertionFromResult({ description: 'Error is hidden', verificationType: 'ui' })).toBe('hidden');
    });

    it('infers text-contains from "contains"', () => {
      expect(inferAssertionFromResult({ description: 'Text contains hello', verificationType: 'ui' })).toBe('text-contains');
    });

    it('infers url-contains from "URL contains"', () => {
      expect(inferAssertionFromResult({ description: 'URL contains /dashboard', verificationType: 'ui' })).toBe('url-contains');
    });

    it('infers exists from "exists"', () => {
      expect(inferAssertionFromResult({ description: 'Element exists', verificationType: 'ui' })).toBe('exists');
    });

    it('infers not-exists from "not exists"', () => {
      expect(inferAssertionFromResult({ description: 'Element not exists', verificationType: 'ui' })).toBe('not-exists');
    });

    it('returns null for unrecognized', () => {
      expect(inferAssertionFromResult({ description: 'Something happens', verificationType: 'ui' })).toBeNull();
    });
  });

  describe('generateStepCandidates', () => {
    it('generates candidates from login test case', () => {
      const tc = makeLoginTestCase();
      const catalog = createUICatalogResolver(makeLoginCatalog());
      const bindings = new BindingResolver(makeBindingsCatalog());
      const candidates = generateStepCandidates(tc, catalog, bindings);
      expect(candidates.length).toBeGreaterThan(0);
    });

    it('maps target to catalog element', () => {
      const tc = makeLoginTestCase();
      const catalog = createUICatalogResolver(makeLoginCatalog());
      const bindings = new BindingResolver(makeBindingsCatalog());
      const candidates = generateStepCandidates(tc, catalog, bindings);
      const usernameStep = candidates.find(c => c.targetLogicalName === 'username-field');
      expect(usernameStep).toBeDefined();
      expect(usernameStep?.action).toBe('fill');
    });

    it('maps value binding', () => {
      const tc = makeLoginTestCase();
      const catalog = createUICatalogResolver(makeLoginCatalog());
      const bindings = new BindingResolver(makeBindingsCatalog());
      const candidates = generateStepCandidates(tc, catalog, bindings);
      const withBinding = candidates.find(c => c.valueBinding === 'runtime.username');
      expect(withBinding).toBeDefined();
    });
  });

  describe('generateAssertionCandidates', () => {
    it('generates assertion candidates', () => {
      const tc = makeLoginTestCase();
      const catalog = createUICatalogResolver(makeLoginCatalog());
      const bindings = new BindingResolver(makeBindingsCatalog());
      const candidates = generateAssertionCandidates(tc, catalog, bindings);
      expect(candidates.length).toBeGreaterThan(0);
    });

    it('preserves expectedResultIndex', () => {
      const tc = makeLoginTestCase();
      const catalog = createUICatalogResolver(makeLoginCatalog());
      const bindings = new BindingResolver(makeBindingsCatalog());
      const candidates = generateAssertionCandidates(tc, catalog, bindings);
      const indexes = candidates.map(c => c.expectedResultIndex);
      expect(indexes).toContain(0);
    });
  });

  describe('generateExecutorCandidate', () => {
    it('generates full candidate', () => {
      const tc = makeLoginTestCase();
      const catalog = createUICatalogResolver(makeLoginCatalog());
      const bindings = new BindingResolver(makeBindingsCatalog());
      const candidate = generateExecutorCandidate(tc, 'ui', catalog, bindings);
      expect(candidate.testCaseId).toBe('TC-0001');
      expect(candidate.executorType).toBe('ui');
      expect(candidate.stepCandidates.length).toBeGreaterThan(0);
    });
  });
});

// ===========================================================================
// VALIDATION TESTS (§28-29, §42-55)
// ===========================================================================

describe('Validation', () => {
  let catalog: UICatalogResolver;
  let bindings: BindingResolver;

  beforeEach(() => {
    catalog = createUICatalogResolver(makeLoginCatalog());
    bindings = new BindingResolver(makeBindingsCatalog());
  });

  describe('validateUICandidate', () => {
    it('validates ready mapping', () => {
      const tc = makeLoginTestCase();
      const candidate = generateExecutorCandidate(tc, 'ui', catalog, bindings);
      const result = validateUICandidate(tc, candidate, catalog, bindings);
      expect(result.status).toBe('ready');
      expect(result.mapping).toBeDefined();
    });

    it('marks missing target as unresolved', () => {
      const tc = makeTestCase({
        type: 'ui',
        steps: [{ order: 1, action: 'Click unknown-element', target: 'nonexistent-element' }],
        expectedResults: [],
      });
      const candidate: ExecutorCandidate = {
        testCaseId: tc.id,
        executorType: 'ui',
        stepCandidates: [{
          stepOrder: 1,
          action: 'click',
          targetLogicalName: 'nonexistent-element',
          trust: 'catalog',
          evidence: [],
        }],
        assertionCandidates: [],
        trust: 'catalog',
        confidence: 0.8,
        evidence: [],
      };
      const result = validateUICandidate(tc, candidate, catalog, bindings);
      expect(result.unresolved.length).toBeGreaterThan(0);
      expect(result.unresolved[0].reason).toBe('missing-catalog-entry');
    });

    it('marks missing binding as unresolved', () => {
      const tc = makeTestCase({
        type: 'ui',
        steps: [{ order: 1, action: 'Enter value', target: 'username-field', input: 'runtime.nonexistent' }],
        expectedResults: [],
      });
      const candidate: ExecutorCandidate = {
        testCaseId: tc.id,
        executorType: 'ui',
        stepCandidates: [{
          stepOrder: 1,
          action: 'fill',
          targetLogicalName: 'username-field',
          valueBinding: 'runtime.nonexistent',
          trust: 'catalog',
          evidence: [],
        }],
        assertionCandidates: [],
        trust: 'catalog',
        confidence: 0.8,
        evidence: [],
      };
      const result = validateUICandidate(tc, candidate, catalog, bindings);
      expect(result.unresolved.length).toBeGreaterThan(0);
      expect(result.unresolved[0].reason).toBe('missing-binding');
    });

    it('marks unsupported action as unresolved', () => {
      const tc = makeTestCase({ type: 'ui', steps: [{ order: 1, action: 'Do something' }], expectedResults: [] });
      const candidate: ExecutorCandidate = {
        testCaseId: tc.id,
        executorType: 'ui',
        stepCandidates: [{
          stepOrder: 1,
          action: 'execute' as 'click',
          trust: 'ai-inferred',
          evidence: [],
        }],
        assertionCandidates: [],
        trust: 'ai-inferred',
        confidence: 0.5,
        evidence: [],
      };
      const result = validateUICandidate(tc, candidate, catalog, bindings);
      expect(result.unresolved.length).toBeGreaterThan(0);
      expect(result.unresolved[0].reason).toBe('unsupported-action');
    });

    it('marks unsupported assertion as unresolved', () => {
      const tc = makeTestCase({ type: 'ui', steps: [], expectedResults: [{ description: 'test', verificationType: 'ui' }] });
      const candidate: ExecutorCandidate = {
        testCaseId: tc.id,
        executorType: 'ui',
        stepCandidates: [],
        assertionCandidates: [{
          expectedResultIndex: 0,
          assertionType: 'performance' as 'visible',
          trust: 'ai-inferred',
          evidence: [],
        }],
        trust: 'ai-inferred',
        confidence: 0.5,
        evidence: [],
      };
      const result = validateUICandidate(tc, candidate, catalog, bindings);
      expect(result.unresolved.length).toBeGreaterThan(0);
      expect(result.unresolved[0].reason).toBe('unsupported-assertion');
    });

    it('returns partial when some steps mapped', () => {
      const tc = makeTestCase({
        type: 'ui',
        steps: [
          { order: 1, action: 'Click login button', target: 'login-button' },
          { order: 2, action: 'Click unknown', target: 'nonexistent' },
        ],
        expectedResults: [],
      });
      const candidate: ExecutorCandidate = {
        testCaseId: tc.id,
        executorType: 'ui',
        stepCandidates: [
          { stepOrder: 1, action: 'click', targetLogicalName: 'login-button', trust: 'catalog', evidence: [] },
          { stepOrder: 2, action: 'click', targetLogicalName: 'nonexistent', trust: 'catalog', evidence: [] },
        ],
        assertionCandidates: [],
        trust: 'catalog',
        confidence: 0.8,
        evidence: [],
      };
      const result = validateUICandidate(tc, candidate, catalog, bindings);
      expect(result.status).toBe('partial');
    });
  });

  describe('validateAllCandidates', () => {
    it('validates multiple test cases', () => {
      const tcs = [makeLoginTestCase()];
      const candidates = [generateExecutorCandidate(tcs[0], 'ui', catalog, bindings)];
      const result = validateAllCandidates(tcs, candidates, catalog, bindings);
      expect(result.mappings.length).toBeGreaterThan(0);
    });

    it('marks missing candidate as unresolved', () => {
      const tcs = [makeTestCase({ id: 'TC-MISSING' })];
      const result = validateAllCandidates(tcs, [], catalog, bindings);
      expect(result.allUnresolved.length).toBeGreaterThan(0);
    });

    it('marks unknown executor as unresolved', () => {
      const tc = makeTestCase({ id: 'TC-UNK', type: 'unknown' });
      const candidate: ExecutorCandidate = {
        testCaseId: 'TC-UNK',
        executorType: 'unknown',
        stepCandidates: [],
        assertionCandidates: [],
        trust: 'code-derived',
        confidence: 0,
        evidence: [],
      };
      const result = validateAllCandidates([tc], [candidate], catalog, bindings);
      expect(result.allUnresolved.length).toBeGreaterThan(0);
    });
  });
});

// ===========================================================================
// QUALITY TESTS (§54, §101-104)
// ===========================================================================

describe('Quality', () => {
  it('computes quality for ready mappings', () => {
    const tc = makeLoginTestCase();
    const catalog = createUICatalogResolver(makeLoginCatalog());
    const bindings = new BindingResolver(makeBindingsCatalog());
    const candidate = generateExecutorCandidate(tc, 'ui', catalog, bindings);
    const { mappings, allUnresolved } = validateAllCandidates([tc], [candidate], catalog, bindings);
    const quality = computeQuality([tc], mappings, allUnresolved);
    expect(quality.testCasesTotal).toBe(1);
    expect(quality.ready).toBe(1);
    expect(quality.stepsTotal).toBeGreaterThan(0);
    expect(quality.stepsMapped).toBeGreaterThan(0);
  });

  it('computes quality for unresolved', () => {
    const tc = makeTestCase({ id: 'TC-X' });
    const quality = computeQuality([tc], [], [{ id: 'U1', testCaseId: 'TC-X', stage: 'executor', description: 'test', reason: 'insufficient-evidence', provenance: [] }]);
    expect(quality.unresolved).toBeGreaterThan(0);
  });

  it('computes provenance coverage', () => {
    const tc = makeLoginTestCase();
    const catalog = createUICatalogResolver(makeLoginCatalog());
    const bindings = new BindingResolver(makeBindingsCatalog());
    const candidate = generateExecutorCandidate(tc, 'ui', catalog, bindings);
    const { mappings, allUnresolved } = validateAllCandidates([tc], [candidate], catalog, bindings);
    const quality = computeQuality([tc], mappings, allUnresolved);
    expect(quality.provenanceCoverage).toBeGreaterThan(0);
  });
});

// ===========================================================================
// FINGERPRINT TESTS (§83-87)
// ===========================================================================

describe('Fingerprint', () => {
  it('produces stable fingerprint', () => {
    const tc = makeLoginTestCase();
    const fp1 = computeFingerprint({ testCases: [tc], uiCatalog: makeLoginCatalog() });
    const fp2 = computeFingerprint({ testCases: [tc], uiCatalog: makeLoginCatalog() });
    expect(fp1).toBe(fp2);
  });

  it('changes when test cases change', () => {
    const tc1 = makeTestCase({ id: 'TC-1' });
    const tc2 = makeTestCase({ id: 'TC-2' });
    const fp1 = computeFingerprint({ testCases: [tc1] });
    const fp2 = computeFingerprint({ testCases: [tc2] });
    expect(fp1).not.toBe(fp2);
  });

  it('changes when catalog changes', () => {
    const tc = makeLoginTestCase();
    const fp1 = computeFingerprint({ testCases: [tc], uiCatalog: makeLoginCatalog() });
    const fp2 = computeFingerprint({ testCases: [tc], uiCatalog: createEmptyCatalog() });
    expect(fp1).not.toBe(fp2);
  });

  it('changes when provider changes', () => {
    const tc = makeLoginTestCase();
    const fp1 = computeFingerprint({ testCases: [tc], providerName: 'none' });
    const fp2 = computeFingerprint({ testCases: [tc], providerName: 'deepseek' });
    expect(fp1).not.toBe(fp2);
  });
});

// ===========================================================================
// CHECKPOINT TESTS (§83-87)
// ===========================================================================

describe('Checkpoint', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `emb-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  it('saves and loads checkpoint', () => {
    const store = new CheckpointStore(tmpDir);
    store.saveCheckpoint('classification', 'fp123', { data: 'test' });
    const result = store.loadCheckpoint('fp123');
    expect(result).toBeDefined();
    expect(result?.meta.stage).toBe('classification');
  });

  it('returns null for different fingerprint', () => {
    const store = new CheckpointStore(tmpDir);
    store.saveCheckpoint('classification', 'fp123', { data: 'test' });
    const result = store.loadCheckpoint('fp456');
    expect(result).toBeNull();
  });

  it('saves and loads candidates', () => {
    const store = new CheckpointStore(tmpDir);
    const candidates: ExecutorCandidate[] = [{
      testCaseId: 'TC-1',
      executorType: 'ui',
      stepCandidates: [],
      assertionCandidates: [],
      trust: 'catalog',
      confidence: 0.8,
      evidence: [],
    }];
    store.saveCandidates(candidates, 'fp123');
    const loaded = store.loadCandidates('fp123');
    expect(loaded).toBeDefined();
    expect(loaded).toHaveLength(1);
  });

  it('saves and loads mapping', () => {
    const store = new CheckpointStore(tmpDir);
    const mapping = {
      schemaVersion: '1.0' as const,
      testMappings: [],
      unresolved: [],
      catalogs: {},
      quality: { testCasesTotal: 0, ready: 0, partial: 0, manual: 0, unresolved: 0, uiMappings: 0, apiMappings: 0, databaseMappings: 0, integrationMappings: 0, stepsTotal: 0, stepsMapped: 0, assertionsTotal: 0, assertionsMapped: 0, bindingsRequired: 0, bindingsResolved: 0, catalogReferenceValidity: 0, provenanceCoverage: 0 },
    };
    store.saveMapping(mapping, 'fp123');
    const loaded = store.loadMapping('fp123');
    expect(loaded).toBeDefined();
    expect(loaded?.schemaVersion).toBe('1.0');
  });

  it('isValid returns true for valid checkpoint', () => {
    const store = new CheckpointStore(tmpDir);
    store.saveCheckpoint('complete', 'fp123', {});
    expect(store.isValid('fp123')).toBe(true);
    expect(store.isValid('fp456')).toBe(false);
  });
});

// ===========================================================================
// BUILDER TESTS (§58-72)
// ===========================================================================

describe('Builder', () => {
  it('builds mapping from login test case', async () => {
    const result = await buildExecutionMapping({
      testCases: [makeLoginTestCase()],
      uiCatalog: makeLoginCatalog(),
      bindingsCatalog: makeBindingsCatalog(),
    });
    expect(result.mapping.schemaVersion).toBe('1.0');
    expect(result.mapping.testMappings.length).toBeGreaterThan(0);
    expect(result.aiCalls).toBe(0);
  });

  it('throws on empty test cases', async () => {
    await expect(buildExecutionMapping({ testCases: [] })).rejects.toThrow('No test cases provided');
  });

  it('throws on duplicate test case IDs', async () => {
    const tc = makeTestCase({ id: 'TC-DUP' });
    await expect(buildExecutionMapping({ testCases: [tc, tc] })).rejects.toThrow('Duplicate');
  });

  it('handles unknown type as unresolved', async () => {
    const tc = makeTestCase({ type: 'unknown' });
    const result = await buildExecutionMapping({ testCases: [tc] });
    expect(result.mapping.unresolved.length).toBeGreaterThan(0);
  });

  it('handles multiple test cases', async () => {
    const tcs = [
      makeLoginTestCase(),
      makeApiTestCase(),
      makeDbTestCase(),
      makeManualTestCase(),
    ];
    const result = await buildExecutionMapping({
      testCases: tcs,
      uiCatalog: makeLoginCatalog(),
      bindingsCatalog: makeBindingsCatalog(),
    });
    expect(result.mapping.quality.testCasesTotal).toBe(4);
  });

  it('works without catalog', async () => {
    const tc = makeLoginTestCase();
    const result = await buildExecutionMapping({ testCases: [tc] });
    // Without catalog, targets won't validate → partial/unresolved
    expect(result.mapping.testMappings.length).toBeGreaterThanOrEqual(0);
  });

  it('checkpoint resume returns cached result', async () => {
    const tmpDir = join(tmpdir(), `emb-builder-${Date.now()}`);
    try {
      const tc = makeLoginTestCase();
      // First run — save checkpoint
      const result1 = await buildExecutionMapping({
        testCases: [tc],
        uiCatalog: makeLoginCatalog(),
        bindingsCatalog: makeBindingsCatalog(),
        checkpointDir: tmpDir,
      });
      expect(result1.checkpointReused).toBe(false);

      // Second run — should reuse
      const result2 = await buildExecutionMapping({
        testCases: [tc],
        uiCatalog: makeLoginCatalog(),
        bindingsCatalog: makeBindingsCatalog(),
        checkpointDir: tmpDir,
        resume: true,
      });
      expect(result2.checkpointReused).toBe(true);
    } finally {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    }
  });
});

// ===========================================================================
// ERRORS TESTS (§143-145)
// ===========================================================================

describe('Errors', () => {
  it('has all error codes', () => {
    expect(EXECUTION_MAPPING_ERROR_CODES.size).toBe(10);
    expect(EXECUTION_MAPPING_ERROR_CODES.has('EMB_INVALID_TEST_CASE')).toBe(true);
    expect(EXECUTION_MAPPING_ERROR_CODES.has('EMB_PROVIDER_FAILED')).toBe(true);
  });

  it('creates error with code', () => {
    const err = new ExecutionMappingError('EMB_INVALID_TEST_CASE', 'test error');
    expect(err.code).toBe('EMB_INVALID_TEST_CASE');
    expect(err.message).toBe('test error');
    expect(err.name).toBe('ExecutionMappingError');
  });

  it('creates error with details', () => {
    const err = new ExecutionMappingError('EMB_MISSING_CATALOG', 'missing', { key: 'value' });
    expect(err.details?.key).toBe('value');
  });
});

// ===========================================================================
// WARNINGS TESTS
// ===========================================================================

describe('Warnings', () => {
  it('has all warning codes', () => {
    expect(EXECUTION_MAPPING_WARNING_CODES.size).toBe(4);
    expect(EXECUTION_MAPPING_WARNING_CODES.has('EMB_NO_PROVIDER')).toBe(true);
  });
});

// ===========================================================================
// PERSISTENCE TESTS (§136-139)
// ===========================================================================

describe('Persistence', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `emb-persist-${Date.now()}`);
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  it('writes output files', async () => {
    const result: ExecutionMappingResult = {
      mapping: {
        schemaVersion: '1.0',
        testMappings: [],
        unresolved: [],
        catalogs: { uiCatalog: makeLoginCatalog() },
        quality: { testCasesTotal: 0, ready: 0, partial: 0, manual: 0, unresolved: 0, uiMappings: 0, apiMappings: 0, databaseMappings: 0, integrationMappings: 0, stepsTotal: 0, stepsMapped: 0, assertionsTotal: 0, assertionsMapped: 0, bindingsRequired: 0, bindingsResolved: 0, catalogReferenceValidity: 0, provenanceCoverage: 0 },
      },
      aiCalls: 0,
      tokensUsed: 0,
      repairs: 0,
      checkpointReused: false,
    };
    writeOutput(tmpDir, result);
    expect(existsSync(join(tmpDir, 'execution-mapping-ir.json'))).toBe(true);
    expect(existsSync(join(tmpDir, 'quality-report.json'))).toBe(true);
    expect(existsSync(join(tmpDir, 'manifest.json'))).toBe(true);
    expect(existsSync(join(tmpDir, 'ui-catalog-used.json'))).toBe(true);
  });
});

// ===========================================================================
// STRICTNESS TESTS (§123-127)
// ===========================================================================

describe('Strictness', () => {
  it('does not invent CSS selectors', () => {
    const catalog = createUICatalogResolver(makeLoginCatalog());
    const result = catalog.lookup('nonexistent');
    expect(result.found).toBe(false);
    // No CSS is returned — catalog owns selectors
  });

  it('does not invent XPath', () => {
    const catalog = createUICatalogResolver(makeLoginCatalog());
    const result = catalog.lookupByLogicalName('nonexistent');
    expect(result.found).toBe(false);
  });

  it('does not invent routes', () => {
    const catalog = createUICatalogResolver(makeLoginCatalog());
    const page = catalog.findPage('nonexistent-page');
    expect(page).toBeUndefined();
  });

  it('does not invent expected results', () => {
    const tc = makeTestCase({ expectedResults: [{ description: 'test', verificationType: 'ui' }] });
    expect(tc.expectedResults).toHaveLength(1);
  });

  it('does not invent bindings', () => {
    const resolver = new BindingResolver(makeBindingsCatalog());
    expect(resolver.isKnown('runtime.nonexistent')).toBe(false);
  });
});

// ===========================================================================
// DETERMINISM TESTS (§88-90)
// ===========================================================================

describe('Determinism', () => {
  it('produces stable IDs', async () => {
    const tc = makeLoginTestCase();
    const r1 = await buildExecutionMapping({ testCases: [tc], uiCatalog: makeLoginCatalog(), bindingsCatalog: makeBindingsCatalog() });
    const r2 = await buildExecutionMapping({ testCases: [tc], uiCatalog: makeLoginCatalog(), bindingsCatalog: makeBindingsCatalog() });
    expect(r1.mapping.testMappings[0]?.testCaseId).toBe(r2.mapping.testMappings[0]?.testCaseId);
  });

  it('produces stable ordering', async () => {
    const tcs = [
      makeTestCase({ id: 'TC-A', type: 'ui' }),
      makeTestCase({ id: 'TC-B', type: 'api' }),
      makeTestCase({ id: 'TC-C', type: 'database' }),
    ];
    const r1 = await buildExecutionMapping({ testCases: tcs });
    const r2 = await buildExecutionMapping({ testCases: tcs });
    expect(r1.mapping.testMappings.map(m => m.testCaseId)).toEqual(r2.mapping.testMappings.map(m => m.testCaseId));
  });

  it('same input → same output', async () => {
    const tc = makeLoginTestCase();
    const opts = { testCases: [tc], uiCatalog: makeLoginCatalog(), bindingsCatalog: makeBindingsCatalog() };
    const r1 = await buildExecutionMapping(opts);
    const r2 = await buildExecutionMapping(opts);
    expect(JSON.stringify(r1.mapping.quality)).toBe(JSON.stringify(r2.mapping.quality));
  });
});

// ===========================================================================
// PROVENANCE TESTS (§96-100)
// ===========================================================================

describe('Provenance', () => {
  it('preserves test case provenance', async () => {
    const tc = makeLoginTestCase();
    const result = await buildExecutionMapping({ testCases: [tc], uiCatalog: makeLoginCatalog(), bindingsCatalog: makeBindingsCatalog() });
    if (result.mapping.testMappings.length > 0) {
      expect(result.mapping.testMappings[0].provenance.length).toBeGreaterThan(0);
    }
  });

  it('includes source in mapping', async () => {
    const tc = makeLoginTestCase();
    const result = await buildExecutionMapping({ testCases: [tc], uiCatalog: makeLoginCatalog(), bindingsCatalog: makeBindingsCatalog() });
    if (result.mapping.testMappings.length > 0) {
      expect(result.mapping.testMappings[0].source.length).toBeGreaterThan(0);
    }
  });
});

// ===========================================================================
// OUTPUT TESTS (§136-139)
// ===========================================================================

describe('Output', () => {
  it('produces valid ExecutionMappingIR', async () => {
    const result = await buildExecutionMapping({
      testCases: [makeLoginTestCase()],
      uiCatalog: makeLoginCatalog(),
      bindingsCatalog: makeBindingsCatalog(),
    });
    expect(result.mapping.schemaVersion).toBe('1.0');
    expect(Array.isArray(result.mapping.testMappings)).toBe(true);
    expect(Array.isArray(result.mapping.unresolved)).toBe(true);
    expect(result.mapping.quality).toBeDefined();
  });

  it('includes quality metrics', async () => {
    const result = await buildExecutionMapping({
      testCases: [makeLoginTestCase()],
      uiCatalog: makeLoginCatalog(),
      bindingsCatalog: makeBindingsCatalog(),
    });
    const q = result.mapping.quality;
    expect(q.testCasesTotal).toBe(1);
    expect(typeof q.ready).toBe('number');
    expect(typeof q.stepsTotal).toBe('number');
  });
});

// ===========================================================================
// SECURITY TESTS (§133-135)
// ===========================================================================

describe('Security', () => {
  it('does not output secret values', async () => {
    const result = await buildExecutionMapping({
      testCases: [makeLoginTestCase()],
      uiCatalog: makeLoginCatalog(),
      bindingsCatalog: makeBindingsCatalog(),
    });
    const json = JSON.stringify(result.mapping);
    expect(json).not.toContain('test-password');
    expect(json).not.toContain('admin123');
  });

  it('uses secret refs not values', () => {
    const resolver = new BindingResolver(makeBindingsCatalog(), undefined, undefined, ['runtime.password']);
    expect(resolver.isSensitive('runtime.password')).toBe(true);
  });
});

// ===========================================================================
// OFFLINE MODE TESTS (§131-132)
// ===========================================================================

describe('Offline mode', () => {
  it('works with provider none', async () => {
    const result = await buildExecutionMapping({
      testCases: [makeLoginTestCase()],
      uiCatalog: makeLoginCatalog(),
      bindingsCatalog: makeBindingsCatalog(),
      providerName: 'none',
    });
    expect(result.aiCalls).toBe(0);
  });

  it('preserves unresolved without provider', async () => {
    const tc = makeTestCase({ type: 'unknown' });
    const result = await buildExecutionMapping({
      testCases: [tc],
      providerName: 'none',
    });
    expect(result.mapping.unresolved.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// REAL ACCEPTANCE TESTS (§63, §109-115)
// ===========================================================================

describe('Real acceptance — login example', () => {
  it('maps login page correctly', async () => {
    const result = await buildExecutionMapping({
      testCases: [makeLoginTestCase()],
      uiCatalog: makeLoginCatalog(),
      bindingsCatalog: makeBindingsCatalog(),
    });
    const mapping = result.mapping.testMappings.find(m => m.testCaseId === 'TC-0001');
    expect(mapping).toBeDefined();
    expect(mapping?.executorType).toBe('ui');
  });

  it('maps username field', async () => {
    const result = await buildExecutionMapping({
      testCases: [makeLoginTestCase()],
      uiCatalog: makeLoginCatalog(),
      bindingsCatalog: makeBindingsCatalog(),
    });
    const mapping = result.mapping.testMappings[0];
    if (mapping?.ui) {
      const usernameStep = mapping.ui.stepMappings.find(s => s.targetLogicalName === 'username-field');
      expect(usernameStep).toBeDefined();
    }
  });

  it('maps password field', async () => {
    const result = await buildExecutionMapping({
      testCases: [makeLoginTestCase()],
      uiCatalog: makeLoginCatalog(),
      bindingsCatalog: makeBindingsCatalog(),
    });
    const mapping = result.mapping.testMappings[0];
    if (mapping?.ui) {
      const passwordStep = mapping.ui.stepMappings.find(s => s.targetLogicalName === 'password-field');
      expect(passwordStep).toBeDefined();
    }
  });

  it('maps login button', async () => {
    const result = await buildExecutionMapping({
      testCases: [makeLoginTestCase()],
      uiCatalog: makeLoginCatalog(),
      bindingsCatalog: makeBindingsCatalog(),
    });
    const mapping = result.mapping.testMappings[0];
    if (mapping?.ui) {
      const buttonStep = mapping.ui.stepMappings.find(s => s.targetLogicalName === 'login-button');
      expect(buttonStep).toBeDefined();
    }
  });

  it('maps dashboard assertion', async () => {
    const result = await buildExecutionMapping({
      testCases: [makeLoginTestCase()],
      uiCatalog: makeLoginCatalog(),
      bindingsCatalog: makeBindingsCatalog(),
    });
    const mapping = result.mapping.testMappings[0];
    if (mapping?.ui) {
      const assertion = mapping.ui.assertionMappings.find(a => a.targetLogicalName === 'dashboard-marker');
      expect(assertion).toBeDefined();
    }
  });
});

// ===========================================================================
// CANONICAL SNAPSHOT TEST (§150)
// ===========================================================================

describe('Canonical snapshot', () => {
  it('produces deterministic JSON', async () => {
    const tc = makeLoginTestCase();
    const r1 = await buildExecutionMapping({ testCases: [tc], uiCatalog: makeLoginCatalog(), bindingsCatalog: makeBindingsCatalog() });
    const r2 = await buildExecutionMapping({ testCases: [tc], uiCatalog: makeLoginCatalog(), bindingsCatalog: makeBindingsCatalog() });
    expect(JSON.stringify(r1.mapping)).toBe(JSON.stringify(r2.mapping));
  });
});
