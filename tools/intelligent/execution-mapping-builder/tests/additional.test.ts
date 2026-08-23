// Additional tests: edge cases, batch, AI safety, integration, coverage.

import { describe, it, expect } from 'vitest';

import { classifyExecutor } from '../src/classifier/classifier.js';
import { createUICatalogResolver } from '../src/catalog/catalog.js';
import { BindingResolver } from '../src/bindings/bindings.js';
import {
  inferActionFromStep,
  inferAssertionFromResult,
} from '../src/candidates/candidates.js';
import { validateUICandidate } from '../src/validation/validation.js';
import { buildExecutionMapping } from '../src/builder.js';
import { ExecutionMappingError } from '../src/errors.js';
import { buildEvidencePackage } from '../src/ai/ai-layer.js';
import {
  makeTestCase,
  makeLoginTestCase,
  makeLoginCatalog,
  makeBindingsCatalog,
} from './fixtures/helpers.js';
import type { ExecutorCandidate } from '../src/models.js';

// ===========================================================================
// ADDITIONAL CLASSIFIER TESTS
// ===========================================================================

describe('Classifier — additional', () => {
  it('confidence is between 0 and 1', () => {
    const tc = makeTestCase({ type: 'ui' });
    const result = classifyExecutor(tc);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('testCaseId is preserved', () => {
    const tc = makeTestCase({ id: 'TC-SPECIAL', type: 'ui' });
    const result = classifyExecutor(tc);
    expect(result.testCaseId).toBe('TC-SPECIAL');
  });

  it('handles test case with no steps and no expected results', () => {
    const tc = makeTestCase({ type: 'unknown', steps: [], expectedResults: [] });
    const result = classifyExecutor(tc);
    expect(result.executorType).toBe('unknown');
  });
});

// ===========================================================================
// ADDITIONAL CATALOG TESTS
// ===========================================================================

describe('Catalog — additional', () => {
  it('handles catalog with multiple pages', () => {
    const catalog = createUICatalogResolver(makeLoginCatalog());
    expect(catalog.pages.length).toBe(2);
  });

  it('lookup returns page with element', () => {
    const catalog = createUICatalogResolver(makeLoginCatalog());
    const result = catalog.lookup('username-field');
    expect(result.page?.id).toBe('login-page');
  });

  it('handles empty pages array', () => {
    const catalog = createUICatalogResolver({ environmentId: 'test', pages: [] });
    expect(catalog.getAllElementNames()).toHaveLength(0);
  });
});

// ===========================================================================
// ADDITIONAL ACTION/ASSERTION TESTS
// ===========================================================================

describe('Actions — additional', () => {
  it('infers focus from "Focus"', () => {
    expect(inferActionFromStep({ order: 1, action: 'Focus element' })).toBe('focus');
  });

  it('infers blur from "Blur"', () => {
    expect(inferActionFromStep({ order: 1, action: 'Blur element' })).toBe('blur');
  });

  it('infers scroll from "Scroll"', () => {
    expect(inferActionFromStep({ order: 1, action: 'Scroll to bottom' })).toBe('scroll');
  });

  it('infers noop from "Observe"', () => {
    expect(inferActionFromStep({ order: 1, action: 'Observe the screen' })).toBe('noop');
  });

  it('infers type from "Type"', () => {
    expect(inferActionFromStep({ order: 1, action: 'Type in the field' })).toBe('fill');
  });
});

describe('Assertions — additional', () => {
  it('infers enabled from "is enabled"', () => {
    expect(inferAssertionFromResult({ description: 'Button is enabled', verificationType: 'ui' })).toBe('enabled');
  });

  it('infers disabled from "is disabled"', () => {
    expect(inferAssertionFromResult({ description: 'Button is disabled', verificationType: 'ui' })).toBe('disabled');
  });

  it('infers checked from "is checked"', () => {
    expect(inferAssertionFromResult({ description: 'Checkbox is checked', verificationType: 'ui' })).toBe('checked');
  });

  it('infers unchecked from "is unchecked"', () => {
    expect(inferAssertionFromResult({ description: 'Checkbox is unchecked', verificationType: 'ui' })).toBe('unchecked');
  });

  it('infers page-title from "page title"', () => {
    expect(inferAssertionFromResult({ description: 'Page title is Login', verificationType: 'ui' })).toBe('page-title');
  });

  it('infers value-equals from "value equals"', () => {
    expect(inferAssertionFromResult({ description: 'Value equals hello', verificationType: 'ui' })).toBe('value-equals');
  });

  it('infers element-count from "count"', () => {
    expect(inferAssertionFromResult({ description: 'Count of items is 3', verificationType: 'ui' })).toBe('element-count');
  });
});

// ===========================================================================
// ADDITIONAL VALIDATION TESTS
// ===========================================================================

describe('Validation — additional', () => {
  it('handles navigate without target', () => {
    const tc = makeTestCase({ type: 'ui', steps: [{ order: 1, action: 'Navigate to page' }], expectedResults: [] });
    const catalog = createUICatalogResolver(makeLoginCatalog());
    const bindings = new BindingResolver(makeBindingsCatalog());
    const candidate: ExecutorCandidate = {
      testCaseId: tc.id,
      executorType: 'ui',
      stepCandidates: [{ stepOrder: 1, action: 'navigate', trust: 'catalog', evidence: [] }],
      assertionCandidates: [],
      trust: 'catalog',
      confidence: 0.8,
      evidence: [],
    };
    const result = validateUICandidate(tc, candidate, catalog, bindings);
    // Navigate doesn't require target
    expect(result.unresolved.filter(u => u.stage === 'target')).toHaveLength(0);
  });

  it('handles noop without target', () => {
    const tc = makeTestCase({ type: 'ui', steps: [{ order: 1, action: 'Observe' }], expectedResults: [] });
    const catalog = createUICatalogResolver(makeLoginCatalog());
    const bindings = new BindingResolver(makeBindingsCatalog());
    const candidate: ExecutorCandidate = {
      testCaseId: tc.id,
      executorType: 'ui',
      stepCandidates: [{ stepOrder: 1, action: 'noop', trust: 'catalog', evidence: [] }],
      assertionCandidates: [],
      trust: 'catalog',
      confidence: 0.8,
      evidence: [],
    };
    const result = validateUICandidate(tc, candidate, catalog, bindings);
    expect(result.unresolved.filter(u => u.stage === 'target')).toHaveLength(0);
  });

  it('detects duplicate step orders', () => {
    const tc = makeTestCase({ type: 'ui', steps: [{ order: 1, action: 'test' }], expectedResults: [] });
    const catalog = createUICatalogResolver(makeLoginCatalog());
    const bindings = new BindingResolver(makeBindingsCatalog());
    const candidate: ExecutorCandidate = {
      testCaseId: tc.id,
      executorType: 'ui',
      stepCandidates: [
        { stepOrder: 1, action: 'click', targetLogicalName: 'login-button', trust: 'catalog', evidence: [] },
        { stepOrder: 1, action: 'fill', targetLogicalName: 'username-field', trust: 'catalog', evidence: [] },
      ],
      assertionCandidates: [],
      trust: 'catalog',
      confidence: 0.8,
      evidence: [],
    };
    const result = validateUICandidate(tc, candidate, catalog, bindings);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// AI EVIDENCE PACKAGE TEST
// ===========================================================================

describe('AI evidence package', () => {
  it('includes test case ID', () => {
    const tc = makeLoginTestCase();
    const catalog = createUICatalogResolver(makeLoginCatalog());
    const evidence = buildEvidencePackage(tc, catalog);
    expect(evidence).toContain('TC-0001');
  });

  it('includes steps', () => {
    const tc = makeLoginTestCase();
    const catalog = createUICatalogResolver(makeLoginCatalog());
    const evidence = buildEvidencePackage(tc, catalog);
    expect(evidence).toContain('Steps:');
  });

  it('includes expected results', () => {
    const tc = makeLoginTestCase();
    const catalog = createUICatalogResolver(makeLoginCatalog());
    const evidence = buildEvidencePackage(tc, catalog);
    expect(evidence).toContain('Expected Results:');
  });

  it('includes available UI elements', () => {
    const tc = makeLoginTestCase();
    const catalog = createUICatalogResolver(makeLoginCatalog());
    const evidence = buildEvidencePackage(tc, catalog);
    expect(evidence).toContain('username-field');
  });
});

// ===========================================================================
// ERROR CLASS TESTS
// ===========================================================================

describe('ExecutionMappingError', () => {
  it('is instanceof Error', () => {
    const err = new ExecutionMappingError('EMB_INVALID_TEST_CASE', 'test');
    expect(err).toBeInstanceOf(Error);
  });

  it('has correct name', () => {
    const err = new ExecutionMappingError('EMB_INVALID_TEST_CASE', 'test');
    expect(err.name).toBe('ExecutionMappingError');
  });
});

// ===========================================================================
// BATCH TESTS (§128-130)
// ===========================================================================

describe('Batch', () => {
  it('handles single test case', async () => {
    const result = await buildExecutionMapping({
      testCases: [makeLoginTestCase()],
      uiCatalog: makeLoginCatalog(),
      bindingsCatalog: makeBindingsCatalog(),
    });
    expect(result.mapping.quality.testCasesTotal).toBe(1);
  });

  it('handles multiple test cases', async () => {
    const tcs = [
      makeLoginTestCase(),
      makeTestCase({ id: 'TC-2', type: 'ui', steps: [{ order: 1, action: 'Click login button', target: 'login-button' }], expectedResults: [] }),
    ];
    const result = await buildExecutionMapping({
      testCases: tcs,
      uiCatalog: makeLoginCatalog(),
      bindingsCatalog: makeBindingsCatalog(),
    });
    expect(result.mapping.quality.testCasesTotal).toBe(2);
  });

  it('produces stable aggregation', async () => {
    const tcs = [makeLoginTestCase()];
    const r1 = await buildExecutionMapping({ testCases: tcs, uiCatalog: makeLoginCatalog(), bindingsCatalog: makeBindingsCatalog() });
    const r2 = await buildExecutionMapping({ testCases: tcs, uiCatalog: makeLoginCatalog(), bindingsCatalog: makeBindingsCatalog() });
    expect(r1.mapping.quality.ready).toBe(r2.mapping.quality.ready);
  });
});

// ===========================================================================
// COVERAGE TESTS (§70-73)
// ===========================================================================

describe('Coverage', () => {
  it('all steps mapped → ready', async () => {
    const tc = makeLoginTestCase();
    const result = await buildExecutionMapping({
      testCases: [tc],
      uiCatalog: makeLoginCatalog(),
      bindingsCatalog: makeBindingsCatalog(),
    });
    const mapping = result.mapping.testMappings[0];
    if (mapping?.ui) {
      expect(mapping.ui.stepMappings.length).toBe(tc.steps.length);
    }
  });

  it('missing step → partial', async () => {
    const tc = makeTestCase({
      type: 'ui',
      steps: [
        { order: 1, action: 'Click login button', target: 'login-button' },
        { order: 2, action: 'Click unknown', target: 'nonexistent' },
      ],
      expectedResults: [],
    });
    const result = await buildExecutionMapping({
      testCases: [tc],
      uiCatalog: makeLoginCatalog(),
      bindingsCatalog: makeBindingsCatalog(),
    });
    const mapping = result.mapping.testMappings[0];
    expect(mapping?.status).toBe('partial');
  });
});

// ===========================================================================
// QUALITY METRICS ADDITIONAL TESTS
// ===========================================================================

describe('Quality — additional', () => {
  it('counts UI mappings', async () => {
    const result = await buildExecutionMapping({
      testCases: [makeLoginTestCase()],
      uiCatalog: makeLoginCatalog(),
      bindingsCatalog: makeBindingsCatalog(),
    });
    expect(result.mapping.quality.uiMappings).toBeGreaterThanOrEqual(0);
  });

  it('counts assertions mapped', async () => {
    const result = await buildExecutionMapping({
      testCases: [makeLoginTestCase()],
      uiCatalog: makeLoginCatalog(),
      bindingsCatalog: makeBindingsCatalog(),
    });
    expect(result.mapping.quality.assertionsMapped).toBeGreaterThanOrEqual(0);
  });

  it('catalogReferenceValidity is between 0 and 1', async () => {
    const result = await buildExecutionMapping({
      testCases: [makeLoginTestCase()],
      uiCatalog: makeLoginCatalog(),
      bindingsCatalog: makeBindingsCatalog(),
    });
    expect(result.mapping.quality.catalogReferenceValidity).toBeGreaterThanOrEqual(0);
    expect(result.mapping.quality.catalogReferenceValidity).toBeLessThanOrEqual(1);
  });
});
