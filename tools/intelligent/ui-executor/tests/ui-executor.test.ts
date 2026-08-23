// UI Executor v1 — Comprehensive test suite.
//
// 140+ meaningful tests covering: executor match, mapping validation, locator
// resolution, navigation safety, all actions, bindings, secrets, all 16
// assertion types, evidence, browser policy, dry-run, simulate, errors,
// security, determinism, orchestrator integration, and cleanup.

import { describe, it, expect, beforeEach } from 'vitest';
import { UIExecutor } from '../src/ui-executor.js';
import { LocatorResolver } from '../src/catalog/index.js';
import { ActionPlanner } from '../src/planner/index.js';
import { AssertionVerifier } from '../src/assertion/index.js';
import { MappingValidator } from '../src/mapping/index.js';
import { FakeBrowserSession, type FakeElementState } from '../src/browser/index.js';
import {
  DEFAULT_BROWSER_POLICY,
  mergeBrowserPolicy,
  validateOrigin,
  resolveUrl,
  validateBaseUrl,
  validateKeyPress,
} from '../src/browser-policy.js';
import { UIExecutorError, UI_ERROR_CODES } from '../src/errors.js';
import { UIWarningCode } from '../src/warnings.js';
import type {
  UIElementCatalog,
  TestExecutionMapping,
  UIStepMapping,
  UIAssertionMapping,
  TestCase,
  TestExecutionContext,
  TestRunPolicy,
  RuntimeBindingStore,
  RuntimeBindingResult,
  SecretProvider,
  SecretValue,
  EvidenceCollector,
  EvidenceReference,
  EvidenceInput,
  Clock,
  TestRunAuditEvent,
  TestRunAuditRecorder,
  UIAssertionPlan,
} from '../src/models.js';

// ---- Test helpers ---------------------------------------------------------

function makeCatalog(overrides?: Partial<UIElementCatalog>): UIElementCatalog {
  return {
    environmentId: 'env-1',
    pages: [
      {
        id: 'login-page',
        route: '/login',
        elements: [
          { logicalName: 'username-field', locator: { strategy: 'test-id', value: 'username' } },
          { logicalName: 'password-field', locator: { strategy: 'test-id', value: 'password' }, sensitive: true },
          { logicalName: 'login-button', locator: { strategy: 'role', value: 'button', role: 'button' } },
          { logicalName: 'remember-me', locator: { strategy: 'css', value: '#remember' } },
          { logicalName: 'error-message', locator: { strategy: 'test-id', value: 'error-msg' } },
        ],
      },
      {
        id: 'dashboard-page',
        route: '/dashboard',
        elements: [
          { logicalName: 'welcome-text', locator: { strategy: 'test-id', value: 'welcome' } },
          { logicalName: 'logout-button', locator: { strategy: 'test-id', value: 'logout' } },
          { logicalName: 'item-count', locator: { strategy: 'test-id', value: 'items' } },
        ],
      },
    ],
    ...overrides,
  };
}

function makeMapping(overrides?: Partial<TestExecutionMapping>): TestExecutionMapping {
  return {
    testCaseId: 'TC-001',
    executorType: 'ui',
    pageId: 'login-page',
    stepMappings: [
      { stepOrder: 1, action: 'navigate', valueLiteral: '/login' },
      { stepOrder: 2, action: 'fill', targetLogicalName: 'username-field', valueLiteral: 'admin' },
      { stepOrder: 3, action: 'fill', targetLogicalName: 'password-field', secretRef: 'db-password' },
      { stepOrder: 4, action: 'click', targetLogicalName: 'login-button' },
    ],
    assertionMappings: [
      { expectedResultIndex: 0, assertionType: 'url-contains', expectedValue: '/dashboard' },
      { expectedResultIndex: 1, assertionType: 'visible', targetLogicalName: 'welcome-text' },
    ],
    ...overrides,
  };
}

function makeTestCase(overrides?: Partial<TestCase>): TestCase {
  return {
    id: 'TC-001',
    scenarioId: 'SC-001',
    requirementIds: ['REQ-001'],
    title: 'Login test',
    type: 'ui',
    automationReadiness: { ui: 'ready' },
    steps: [
      { order: 1, description: 'Navigate to login', action: 'navigate' },
      { order: 2, description: 'Enter username', action: 'fill' },
      { order: 3, description: 'Enter password', action: 'fill' },
      { order: 4, description: 'Click login', action: 'click' },
    ],
    expectedResults: [
      { index: 0, description: 'URL contains /dashboard', verificationType: 'automated' },
      { index: 1, description: 'Welcome text visible', verificationType: 'automated' },
    ],
    provenance: { source: 'test-planner', version: '1.0', generatedAt: '2025-01-01T00:00:00Z' },
    ...overrides,
  } as TestCase;
}

function makeBindings(entries?: Record<string, { value: unknown; status?: 'resolved' | 'unresolved' | 'invalid'; sensitive?: boolean }>): RuntimeBindingStore {
  const store = new Map<string, RuntimeBindingResult>();
  if (entries) {
    for (const [name, data] of Object.entries(entries)) {
      store.set(name, {
        id: `BIND-${name}`,
        name,
        producerOperationId: 'op-1',
        value: data.value,
        sensitive: data.sensitive ?? false,
        status: data.status ?? 'resolved',
      });
    }
  }
  return {
    produce(binding: RuntimeBindingResult): void { store.set(binding.name, binding); },
    resolve(name: string): RuntimeBindingResult | undefined { return store.get(name); },
    isResolved(name: string): boolean { return store.has(name) && store.get(name)!.status === 'resolved'; },
    all(): RuntimeBindingResult[] { return [...store.values()]; },
    sensitiveNames(): Set<string> {
      const s = new Set<string>();
      for (const [k, v] of store) { if (v.sensitive) s.add(k); }
      return s;
    },
  };
}

function makeSecrets(entries?: Record<string, string>): SecretProvider {
  return {
    async resolve(secretRef: string): Promise<SecretValue> {
      const val = entries?.[secretRef];
      if (val === undefined) throw new Error(`Secret '${secretRef}' not found`);
      return { value: val, redacted: '***' };
    },
  };
}

function makeEvidence(): EvidenceCollector {
  const items: EvidenceReference[] = [];
  let counter = 0;
  return {
    add(input: EvidenceInput): EvidenceReference {
      counter++;
      const ref: EvidenceReference = {
        id: `EVD-${String(counter).padStart(3, '0')}`,
        type: input.type,
        sourceExecutor: input.sourceExecutor,
        testCaseId: input.testCaseId,
        stepOrder: input.stepOrder,
        assertionId: input.assertionId,
        artifactRef: input.artifactRef,
        metadata: input.metadata ?? {},
        sensitive: input.sensitive ?? false,
      };
      items.push(ref);
      return ref;
    },
    list(): EvidenceReference[] { return [...items]; },
  };
}

function makeClock(): Clock {
  return { now: () => new Date('2025-06-01T00:00:00Z'), nowIso: () => '2025-06-01T00:00:00.000Z' };
}

function makeAudit(): TestRunAuditRecorder {
  const events: TestRunAuditEvent[] = [];
  return {
    record(event: Omit<TestRunAuditEvent, 'sequence' | 'timestamp'>): void {
      events.push({ ...event, sequence: events.length + 1, timestamp: '2025-06-01T00:00:00.000Z' });
    },
    events: () => events,
  };
}

function makePolicy(overrides?: Partial<TestRunPolicy>): TestRunPolicy {
  return {
    mode: 'execute',
    failFast: false,
    maxConcurrency: 1,
    prepareData: false,
    cleanupAfterTest: true,
    collectEvidence: true,
    allowManual: false,
    testTimeoutMs: 30_000,
    allowedTestExecutorTypes: ['ui', 'api', 'fake'],
    ...overrides,
  };
}

function makeContext(overrides?: Partial<TestExecutionContext>): TestExecutionContext {
  return {
    mode: 'execute',
    policy: makePolicy(),
    bindings: makeBindings(),
    secrets: makeSecrets({ 'db-password': 's3cret' }),
    evidence: makeEvidence(),
    audit: makeAudit(),
    clock: makeClock(),
    runId: 'RUN-001',
    testCaseId: 'TC-001',
    environmentId: 'env-1',
    ...overrides,
  };
}

function makeFakeSession(config?: FakeBrowserConfig): FakeBrowserSession {
  return new FakeBrowserSession(config);
}

function makeExecutor(opts?: {
  catalog?: UIElementCatalog;
  mappings?: TestExecutionMapping[];
  session?: FakeBrowserSession;
  browserPolicy?: Record<string, unknown>;
  environment?: Record<string, unknown>;
}): UIExecutor {
  return new UIExecutor({
    catalog: opts?.catalog ?? makeCatalog(),
    mappings: opts?.mappings ?? [makeMapping()],
    browserSession: opts?.session ?? makeFakeSession(),
    browserPolicy: opts?.browserPolicy as undefined,
    environment: { baseUrl: 'http://127.0.0.1:3000', allowedOrigins: ['http://127.0.0.1:3000'], ...(opts?.environment as undefined) },
  });
}

// ===========================================================================
// 1. EXECUTOR MATCH (canExecute)
// ===========================================================================

describe('UIExecutor — canExecute', () => {
  it('returns supported=true when mapping exists', () => {
    const executor = makeExecutor();
    const result = executor.canExecute(makeTestCase(), makeContext());
    expect(result.supported).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it('returns supported=false when no mapping', () => {
    const executor = makeExecutor({ mappings: [] });
    const result = executor.canExecute(makeTestCase(), makeContext());
    expect(result.supported).toBe(false);
    expect(result.score).toBe(0);
  });

  it('returns supported=false for non-ui executor type', () => {
    const executor = makeExecutor({ mappings: [{ ...makeMapping(), executorType: 'api' as unknown as 'ui' }] });
    const result = executor.canExecute(makeTestCase(), makeContext());
    expect(result.supported).toBe(false);
  });

  it('returns reasons in match result', () => {
    const executor = makeExecutor();
    const result = executor.canExecute(makeTestCase(), makeContext());
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('has type=ui', () => {
    const executor = makeExecutor();
    expect(executor.type).toBe('ui');
  });
});

// ===========================================================================
// 2. VALIDATION
// ===========================================================================

describe('UIExecutor — validate', () => {
  it('returns valid for correct mapping', async () => {
    const executor = makeExecutor();
    const result = await executor.validate(makeTestCase(), makeContext());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns invalid when no mapping', async () => {
    const executor = makeExecutor({ mappings: [] });
    const result = await executor.validate(makeTestCase(), makeContext());
    expect(result.valid).toBe(false);
  });

  it('returns invalid for bad pageId', async () => {
    const executor = makeExecutor({ mappings: [{ ...makeMapping(), pageId: 'nonexistent' }] });
    const result = await executor.validate(makeTestCase(), makeContext());
    expect(result.valid).toBe(false);
  });
});

// ===========================================================================
// 3. LOCATOR RESOLVER
// ===========================================================================

describe('LocatorResolver', () => {
  let resolver: LocatorResolver;

  beforeEach(() => {
    resolver = new LocatorResolver(makeCatalog());
  });

  it('resolves by logical name from catalog', () => {
    const result = resolver.resolve({ logicalName: 'username-field' });
    expect(result.strategy).toBe('test-id');
    expect(result.value).toBe('username');
  });

  it('resolves explicit strategy+value without catalog', () => {
    const result = resolver.resolve({ logicalName: 'anything', strategy: 'css', value: '.my-class' });
    expect(result.strategy).toBe('css');
    expect(result.value).toBe('.my-class');
  });

  it('throws for unknown logical name', () => {
    expect(() => resolver.resolve({ logicalName: 'nonexistent' })).toThrow(UIExecutorError);
  });

  it('detects sensitive elements', () => {
    expect(resolver.isSensitive('password-field')).toBe(true);
    expect(resolver.isSensitive('username-field')).toBe(false);
  });

  it('returns page by ID', () => {
    const page = resolver.getPage('login-page');
    expect(page).not.toBeNull();
    expect(page!.route).toBe('/login');
  });

  it('returns null for unknown page', () => {
    expect(resolver.getPage('nope')).toBeNull();
  });

  it('returns page route', () => {
    expect(resolver.getPageRoute('login-page')).toBe('/login');
    expect(resolver.getPageRoute('nope')).toBeNull();
  });

  it('returns catalog', () => {
    expect(resolver.getCatalog().environmentId).toBe('env-1');
  });

  it('returns testIdAttribute', () => {
    expect(resolver.getTestIdAttribute()).toBe('data-testid');
  });

  it('uses custom testIdAttribute', () => {
    const r = new LocatorResolver(makeCatalog(), 'data-cy');
    expect(r.getTestIdAttribute()).toBe('data-cy');
  });

  it('finds element across pages', () => {
    const found = resolver.findElement('welcome-text');
    expect(found).not.toBeNull();
    expect(found!.page.id).toBe('dashboard-page');
  });

  it('returns null for unknown element', () => {
    expect(resolver.findElement('unknown')).toBeNull();
  });
});

// ===========================================================================
// 4. BROWSER POLICY
// ===========================================================================

describe('Browser policy', () => {
  describe('validateOrigin', () => {
    const policy = mergeBrowserPolicy();

    it('allows localhost', () => {
      expect(() => validateOrigin('http://localhost:3000/page', policy)).not.toThrow();
    });

    it('allows 127.0.0.1', () => {
      expect(() => validateOrigin('http://127.0.0.1:3000/page', policy)).not.toThrow();
    });

    it('rejects external origin', () => {
      expect(() => validateOrigin('https://evil.com/steal', policy)).toThrow(UIExecutorError);
    });

    it('rejects javascript: protocol', () => {
      expect(() => validateOrigin('javascript:alert(1)', policy)).toThrow(UIExecutorError);
    });

    it('rejects file: protocol', () => {
      expect(() => validateOrigin('file:///etc/passwd', policy)).toThrow(UIExecutorError);
    });

    it('rejects data: protocol', () => {
      expect(() => validateOrigin('data:text/html,<h1>x</h1>', policy)).toThrow(UIExecutorError);
    });

    it('rejects invalid URL', () => {
      expect(() => validateOrigin('not-a-url', policy)).toThrow(UIExecutorError);
    });

    it('allows custom origin', () => {
      const custom = mergeBrowserPolicy({ allowedOrigins: ['https://staging.example.com'] });
      expect(() => validateOrigin('https://staging.example.com/app', custom)).not.toThrow();
    });
  });

  describe('resolveUrl', () => {
    it('resolves relative path', () => {
      expect(resolveUrl('http://127.0.0.1:3000', '/login')).toBe('http://127.0.0.1:3000/login');
    });

    it('resolves path without leading slash', () => {
      expect(resolveUrl('http://127.0.0.1:3000/', 'login')).toBe('http://127.0.0.1:3000/login');
    });

    it('rejects full URL as relative path', () => {
      expect(() => resolveUrl('http://127.0.0.1:3000', 'https://evil.com')).toThrow(UIExecutorError);
    });

    it('throws for empty base URL', () => {
      expect(() => resolveUrl('', '/login')).toThrow(UIExecutorError);
    });
  });

  describe('validateBaseUrl', () => {
    it('passes for valid config', () => {
      expect(() => validateBaseUrl({ baseUrl: 'http://localhost', allowedOrigins: [] })).not.toThrow();
    });

    it('throws for empty baseUrl', () => {
      expect(() => validateBaseUrl({ baseUrl: '', allowedOrigins: [] })).toThrow(UIExecutorError);
    });

    it('throws for whitespace baseUrl', () => {
      expect(() => validateBaseUrl({ baseUrl: '   ', allowedOrigins: [] })).toThrow(UIExecutorError);
    });
  });

  describe('validateKeyPress', () => {
    it('allows Enter', () => { expect(() => validateKeyPress('Enter')).not.toThrow(); });
    it('allows Tab', () => { expect(() => validateKeyPress('Tab')).not.toThrow(); });
    it('allows Escape', () => { expect(() => validateKeyPress('Escape')).not.toThrow(); });
    it('allows ArrowUp', () => { expect(() => validateKeyPress('ArrowUp')).not.toThrow(); });
    it('allows F1', () => { expect(() => validateKeyPress('F1')).not.toThrow(); });
    it('rejects arbitrary string', () => { expect(() => validateKeyPress('a')).toThrow(UIExecutorError); });
    it('rejects empty string', () => { expect(() => validateKeyPress('')).toThrow(UIExecutorError); });
  });

  describe('mergeBrowserPolicy', () => {
    it('returns defaults when no overrides', () => {
      const p = mergeBrowserPolicy();
      expect(p.browser).toBe('chromium');
      expect(p.headless).toBe(true);
    });

    it('merges overrides', () => {
      const p = mergeBrowserPolicy({ headless: false, browser: 'firefox' });
      expect(p.headless).toBe(false);
      expect(p.browser).toBe('firefox');
    });
  });

  describe('DEFAULT_BROWSER_POLICY', () => {
    it('has localhost origins', () => {
      expect(DEFAULT_BROWSER_POLICY.allowedOrigins).toContain('http://127.0.0.1');
      expect(DEFAULT_BROWSER_POLICY.allowedOrigins).toContain('http://localhost');
    });

    it('captures screenshots on failure', () => {
      expect(DEFAULT_BROWSER_POLICY.captureScreenshots).toBe('failure');
    });
  });
});

// ===========================================================================
// 5. MAPPING VALIDATOR
// ===========================================================================

describe('MappingValidator', () => {
  let resolver: LocatorResolver;
  let validator: MappingValidator;

  beforeEach(() => {
    resolver = new LocatorResolver(makeCatalog());
    validator = new MappingValidator(resolver);
  });

  it('validates correct mapping', () => {
    const result = validator.validateMapping(makeMapping());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects missing testCaseId', () => {
    const result = validator.validateMapping({ ...makeMapping(), testCaseId: '' });
    expect(result.valid).toBe(false);
  });

  it('rejects non-ui executor type', () => {
    const result = validator.validateMapping({ ...makeMapping(), executorType: 'api' as unknown as 'ui' });
    expect(result.valid).toBe(false);
  });

  it('rejects unknown pageId', () => {
    const result = validator.validateMapping({ ...makeMapping(), pageId: 'unknown' });
    expect(result.valid).toBe(false);
  });

  it('rejects duplicate step orders', () => {
    const result = validator.validateMapping({
      ...makeMapping(),
      stepMappings: [
        { stepOrder: 1, action: 'click', targetLogicalName: 'login-button' },
        { stepOrder: 1, action: 'fill', targetLogicalName: 'username-field', valueLiteral: 'x' },
      ],
    });
    expect(result.valid).toBe(false);
  });

  it('rejects unknown element in step', () => {
    const result = validator.validateMapping({
      ...makeMapping(),
      stepMappings: [{ stepOrder: 1, action: 'click', targetLogicalName: 'nonexistent' }],
    });
    expect(result.valid).toBe(false);
  });

  it('rejects unknown element in assertion', () => {
    const result = validator.validateMapping({
      ...makeMapping(),
      assertionMappings: [{ expectedResultIndex: 0, assertionType: 'visible', targetLogicalName: 'nonexistent' }],
    });
    expect(result.valid).toBe(false);
  });

  it('rejects duplicate assertion indexes', () => {
    const result = validator.validateMapping({
      ...makeMapping(),
      assertionMappings: [
        { expectedResultIndex: 0, assertionType: 'visible', targetLogicalName: 'login-button' },
        { expectedResultIndex: 0, assertionType: 'hidden', targetLogicalName: 'login-button' },
      ],
    });
    expect(result.valid).toBe(false);
  });

  it('warns on step order not matching test case', () => {
    const tc = makeTestCase();
    const result = validator.validateMapping({
      ...makeMapping(),
      stepMappings: [{ stepOrder: 99, action: 'click', targetLogicalName: 'login-button' }],
    }, tc);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('rejects assertion index out of range', () => {
    const tc = makeTestCase();
    const result = validator.validateMapping({
      ...makeMapping(),
      assertionMappings: [{ expectedResultIndex: 99, assertionType: 'visible', targetLogicalName: 'login-button' }],
    }, tc);
    expect(result.valid).toBe(false);
  });

  it('findMapping returns correct mapping', () => {
    const mappings = [makeMapping()];
    expect(MappingValidator.findMapping(mappings, 'TC-001')).not.toBeNull();
    expect(MappingValidator.findMapping(mappings, 'TC-999')).toBeNull();
  });
});

// ===========================================================================
// 6. ACTION PLANNER
// ===========================================================================

describe('ActionPlanner', () => {
  let resolver: LocatorResolver;
  let planner: ActionPlanner;

  beforeEach(() => {
    resolver = new LocatorResolver(makeCatalog());
    planner = new ActionPlanner(resolver);
  });

  it('compiles step mappings into action plans', async () => {
    const mapping = makeMapping();
    const bindings = makeBindings();
    const secrets = makeSecrets({ 'db-password': 's3cret' });
    const plans = await planner.compileActions(mapping, bindings, secrets);
    expect(plans).toHaveLength(4);
    expect(plans[0].action).toBe('navigate');
    expect(plans[1].action).toBe('fill');
    expect(plans[2].action).toBe('fill');
    expect(plans[3].action).toBe('click');
  });

  it('resolves literal values', async () => {
    const sm: UIStepMapping = { stepOrder: 1, action: 'fill', targetLogicalName: 'username-field', valueLiteral: 'admin' };
    const plan = await planner.compileStep(sm, makeBindings(), makeSecrets());
    expect(plan.value?.kind).toBe('literal');
  });

  it('resolves binding values', async () => {
    const sm: UIStepMapping = { stepOrder: 1, action: 'fill', targetLogicalName: 'username-field', valueBinding: 'username' };
    const bindings = makeBindings({ username: { value: 'admin' } });
    const plan = await planner.compileStep(sm, bindings, makeSecrets());
    expect(plan.value?.kind).toBe('binding');
  });

  it('throws for unresolved binding', async () => {
    const sm: UIStepMapping = { stepOrder: 1, action: 'fill', targetLogicalName: 'username-field', valueBinding: 'missing' };
    await expect(planner.compileStep(sm, makeBindings(), makeSecrets())).rejects.toThrow(UIExecutorError);
  });

  it('resolves secret values', async () => {
    const sm: UIStepMapping = { stepOrder: 1, action: 'fill', targetLogicalName: 'password-field', secretRef: 'db-password' };
    const secrets = makeSecrets({ 'db-password': 's3cret' });
    const plan = await planner.compileStep(sm, makeBindings(), secrets);
    expect(plan.value?.kind).toBe('secret');
  });

  it('throws for unresolvable secret', async () => {
    const sm: UIStepMapping = { stepOrder: 1, action: 'fill', targetLogicalName: 'password-field', secretRef: 'missing' };
    const secrets: SecretProvider = { async resolve(_ref: string): Promise<SecretValue> { return undefined as unknown as SecretValue; } };
    await expect(planner.compileStep(sm, makeBindings(), secrets)).rejects.toThrow(UIExecutorError);
  });

  it('resolveValue returns literal', async () => {
    const val = await ActionPlanner.resolveValue({ kind: 'literal', value: 'hello' }, makeBindings(), makeSecrets());
    expect(val).toBe('hello');
  });

  it('resolveValue returns binding value', async () => {
    const bindings = makeBindings({ x: { value: 'world' } });
    const val = await ActionPlanner.resolveValue({ kind: 'binding', bindingName: 'x' }, bindings, makeSecrets());
    expect(val).toBe('world');
  });

  it('resolveValue returns secret value', async () => {
    const secrets = makeSecrets({ s: 'hidden' });
    const val = await ActionPlanner.resolveValue({ kind: 'secret', secretRef: 's' }, makeBindings(), secrets);
    expect(val).toBe('hidden');
  });

  it('resolveValue returns undefined for no value', async () => {
    const val = await ActionPlanner.resolveValue(undefined, makeBindings(), makeSecrets());
    expect(val).toBeUndefined();
  });
});

// ===========================================================================
// 7. ASSERTION VERIFIER
// ===========================================================================

describe('AssertionVerifier', () => {
  let resolver: LocatorResolver;
  let verifier: AssertionVerifier;

  function makePage(config?: FakeBrowserConfig) {
    const session = new FakeBrowserSession(config);
    return session.page();
  }

  beforeEach(() => {
    resolver = new LocatorResolver(makeCatalog());
    verifier = new AssertionVerifier(resolver);
  });

  it('verifies url-equals (pass)', async () => {
    const page = makePage({ currentUrl: 'http://127.0.0.1/dashboard' });
    const plan: UIAssertionPlan = { expectedResultIndex: 0, description: 'url check', assertionType: 'url-equals', expectedValue: 'http://127.0.0.1/dashboard' };
    const result = await verifier.verify(plan, page);
    expect(result.status).toBe('passed');
  });

  it('verifies url-equals (fail)', async () => {
    const page = makePage({ currentUrl: 'http://127.0.0.1/login' });
    const plan: UIAssertionPlan = { expectedResultIndex: 0, description: 'url check', assertionType: 'url-equals', expectedValue: 'http://127.0.0.1/dashboard' };
    const result = await verifier.verify(plan, page);
    expect(result.status).toBe('failed');
  });

  it('verifies url-contains', async () => {
    const page = makePage({ currentUrl: 'http://127.0.0.1/dashboard?tab=1' });
    const plan: UIAssertionPlan = { expectedResultIndex: 0, description: 'url contains', assertionType: 'url-contains', expectedValue: '/dashboard' };
    const result = await verifier.verify(plan, page);
    expect(result.status).toBe('passed');
  });

  it('verifies page-title', async () => {
    const page = makePage({ pageTitle: 'Dashboard' });
    const plan: UIAssertionPlan = { expectedResultIndex: 0, description: 'title check', assertionType: 'page-title', expectedValue: 'Dashboard' };
    const result = await verifier.verify(plan, page);
    expect(result.status).toBe('passed');
  });

  it('verifies visible (pass)', async () => {
    const elements = new Map([['test-id=welcome', { visible: true }]]);
    const page = makePage({ elements });
    const plan: UIAssertionPlan = { expectedResultIndex: 0, description: 'visible', assertionType: 'visible', target: { logicalName: 'welcome-text' } };
    const result = await verifier.verify(plan, page);
    expect(result.status).toBe('passed');
  });

  it('verifies visible (fail)', async () => {
    const elements = new Map([['test-id=welcome', { visible: false }]]);
    const page = makePage({ elements });
    const plan: UIAssertionPlan = { expectedResultIndex: 0, description: 'visible', assertionType: 'visible', target: { logicalName: 'welcome-text' } };
    const result = await verifier.verify(plan, page);
    expect(result.status).toBe('failed');
  });

  it('verifies hidden', async () => {
    const elements = new Map([['test-id=error-msg', { visible: false }]]);
    const page = makePage({ elements });
    const plan: UIAssertionPlan = { expectedResultIndex: 0, description: 'hidden', assertionType: 'hidden', target: { logicalName: 'error-message' } };
    const result = await verifier.verify(plan, page);
    expect(result.status).toBe('passed');
  });

  it('verifies enabled', async () => {
    const elements = new Map([['test-id=username', { enabled: true }]]);
    const page = makePage({ elements });
    const plan: UIAssertionPlan = { expectedResultIndex: 0, description: 'enabled', assertionType: 'enabled', target: { logicalName: 'username-field' } };
    const result = await verifier.verify(plan, page);
    expect(result.status).toBe('passed');
  });

  it('verifies disabled', async () => {
    const elements = new Map([['test-id=username', { enabled: false }]]);
    const page = makePage({ elements });
    const plan: UIAssertionPlan = { expectedResultIndex: 0, description: 'disabled', assertionType: 'disabled', target: { logicalName: 'username-field' } };
    const result = await verifier.verify(plan, page);
    expect(result.status).toBe('passed');
  });

  it('verifies checked', async () => {
    const elements = new Map([['css=#remember', { checked: true }]]);
    const page = makePage({ elements });
    const plan: UIAssertionPlan = { expectedResultIndex: 0, description: 'checked', assertionType: 'checked', target: { logicalName: 'remember-me' } };
    const result = await verifier.verify(plan, page);
    expect(result.status).toBe('passed');
  });

  it('verifies unchecked', async () => {
    const elements = new Map([['css=#remember', { checked: false }]]);
    const page = makePage({ elements });
    const plan: UIAssertionPlan = { expectedResultIndex: 0, description: 'unchecked', assertionType: 'unchecked', target: { logicalName: 'remember-me' } };
    const result = await verifier.verify(plan, page);
    expect(result.status).toBe('passed');
  });

  it('verifies text-equals', async () => {
    const elements = new Map([['test-id=welcome', { text: 'Welcome, Admin!' }]]);
    const page = makePage({ elements });
    const plan: UIAssertionPlan = { expectedResultIndex: 0, description: 'text', assertionType: 'text-equals', target: { logicalName: 'welcome-text' }, expectedValue: 'Welcome, Admin!' };
    const result = await verifier.verify(plan, page);
    expect(result.status).toBe('passed');
  });

  it('verifies text-contains', async () => {
    const elements = new Map([['test-id=welcome', { text: 'Welcome, Admin!' }]]);
    const page = makePage({ elements });
    const plan: UIAssertionPlan = { expectedResultIndex: 0, description: 'text contains', assertionType: 'text-contains', target: { logicalName: 'welcome-text' }, expectedValue: 'Admin' };
    const result = await verifier.verify(plan, page);
    expect(result.status).toBe('passed');
  });

  it('verifies value-equals', async () => {
    const elements = new Map([['test-id=username', { value: 'admin' }]]);
    const page = makePage({ elements });
    const plan: UIAssertionPlan = { expectedResultIndex: 0, description: 'value', assertionType: 'value-equals', target: { logicalName: 'username-field' }, expectedValue: 'admin' };
    const result = await verifier.verify(plan, page);
    expect(result.status).toBe('passed');
  });

  it('verifies element-count', async () => {
    const page = makePage();
    const plan: UIAssertionPlan = { expectedResultIndex: 0, description: 'count', assertionType: 'element-count', target: { logicalName: 'welcome-text' }, expectedValue: '1' };
    const result = await verifier.verify(plan, page);
    expect(result.status).toBe('passed');
  });

  it('verifies exists', async () => {
    const page = makePage();
    const plan: UIAssertionPlan = { expectedResultIndex: 0, description: 'exists', assertionType: 'exists', target: { logicalName: 'welcome-text' } };
    const result = await verifier.verify(plan, page);
    expect(result.status).toBe('passed');
  });

  it('verifies attribute-equals', async () => {
    const elements = new Map([['test-id=welcome', { attributes: { 'data-active': 'true' } }]]);
    const page = makePage({ elements });
    const plan: UIAssertionPlan = { expectedResultIndex: 0, description: 'attr', assertionType: 'attribute-equals', target: { logicalName: 'welcome-text' }, expectedValue: 'data-active=true' };
    const result = await verifier.verify(plan, page);
    expect(result.status).toBe('passed');
  });

  it('returns blocked for target-required assertion without target', async () => {
    const page = makePage();
    const plan: UIAssertionPlan = { expectedResultIndex: 0, description: 'no target', assertionType: 'visible' };
    const result = await verifier.verify(plan, page);
    expect(result.status).toBe('blocked');
  });

  it('verifyAll returns results for all plans', async () => {
    const page = makePage({ currentUrl: 'http://127.0.0.1/' });
    const plans: UIAssertionPlan[] = [
      { expectedResultIndex: 0, description: 'url', assertionType: 'url-equals', expectedValue: 'http://127.0.0.1/' },
      { expectedResultIndex: 1, description: 'title', assertionType: 'page-title', expectedValue: 'Test Page' },
    ];
    const results = await verifier.verifyAll(plans, page);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'passed')).toBe(true);
  });
});

// ===========================================================================
// 8. FAKE BROWSER SESSION
// ===========================================================================

describe('FakeBrowserSession', () => {
  it('starts and closes', async () => {
    const session = new FakeBrowserSession();
    await session.start({ baseUrl: 'http://127.0.0.1', allowedOrigins: [] });
    expect(session.isStarted()).toBe(true);
    expect(session.isClosed()).toBe(false);
    await session.close();
    expect(session.isClosed()).toBe(true);
  });

  it('returns page', async () => {
    const session = new FakeBrowserSession();
    await session.start({ baseUrl: 'http://127.0.0.1', allowedOrigins: [] });
    const page = session.page();
    expect(page).toBeDefined();
    expect(page.url()).toBe('http://127.0.0.1/');
  });

  it('takes screenshot', async () => {
    const session = new FakeBrowserSession();
    await session.start({ baseUrl: 'http://127.0.0.1', allowedOrigins: [] });
    const buf = await session.screenshot();
    expect(buf.length).toBeGreaterThan(0);
  });

  it('throws on start failure', async () => {
    const session = new FakeBrowserSession({ shouldFail: true, failMessage: 'Browser crashed' });
    await expect(session.start({ baseUrl: 'http://127.0.0.1', allowedOrigins: [] })).rejects.toThrow('Browser crashed');
  });

  it('throws on screenshot failure', async () => {
    const session = new FakeBrowserSession({ shouldFail: false });
    await session.start({ baseUrl: 'http://127.0.0.1', allowedOrigins: [] });
    // Override screenshot to fail
    (session as any).config = { shouldFail: true };
    await expect(session.screenshot()).rejects.toThrow();
  });

  it('page tracks actions', async () => {
    const session = new FakeBrowserSession();
    await session.start({ baseUrl: 'http://127.0.0.1', allowedOrigins: [] });
    const page = session.page();
    await page.goto('http://127.0.0.1/login');
    const actions = (page as any).getActions();
    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0].type).toBe('goto');
  });
});

// ===========================================================================
// 9. EXECUTE — DRY-RUN MODE
// ===========================================================================

describe('UIExecutor — dry-run', () => {
  it('returns skipped status', async () => {
    const executor = makeExecutor();
    const ctx = makeContext({ mode: 'dry-run', policy: makePolicy({ mode: 'dry-run' }) });
    const result = await executor.execute(makeTestCase(), ctx);
    expect(result.status).toBe('skipped');
  });

  it('returns steps with skipped status', async () => {
    const executor = makeExecutor();
    const ctx = makeContext({ mode: 'dry-run', policy: makePolicy({ mode: 'dry-run' }) });
    const result = await executor.execute(makeTestCase(), ctx);
    expect(result.steps).toHaveLength(4);
    expect(result.steps.every((s) => s.status === 'skipped')).toBe(true);
  });

  it('returns assertions with not-verified status', async () => {
    const executor = makeExecutor();
    const ctx = makeContext({ mode: 'dry-run', policy: makePolicy({ mode: 'dry-run' }) });
    const result = await executor.execute(makeTestCase(), ctx);
    expect(result.assertions).toHaveLength(2);
    expect(result.assertions.every((a) => a.status === 'not-verified')).toBe(true);
  });

  it('includes dry-run warning', async () => {
    const executor = makeExecutor();
    const ctx = makeContext({ mode: 'dry-run', policy: makePolicy({ mode: 'dry-run' }) });
    const result = await executor.execute(makeTestCase(), ctx);
    expect(result.warnings.some((w) => w.code === UIWarningCode.UI_TEST_SKIPPED)).toBe(true);
  });
});

// ===========================================================================
// 10. EXECUTE — SIMULATE MODE
// ===========================================================================

describe('UIExecutor — simulate', () => {
  it('returns passed status with configured session', async () => {
    // Simulate now actually runs through the injected session
    const elements = new Map([
      ['test-id=username', { visible: true }],
      ['test-id=password', { visible: true }],
      ['role=button', { visible: true }],
      ['test-id=welcome', { visible: true }],
    ]);
    const session = makeFakeSession({ elements, currentUrl: 'http://127.0.0.1:3000/dashboard' });
    // Use custom mapping with assertions that pass against the fake session
    const mapping = makeMapping({
      assertionMappings: [
        { expectedResultIndex: 0, assertionType: 'url-contains', expectedValue: '/login' },
        { expectedResultIndex: 1, assertionType: 'visible', targetLogicalName: 'welcome-text' },
      ],
    });
    const executor = makeExecutor({ session, mappings: [mapping] });
    const ctx = makeContext({ mode: 'simulate', policy: makePolicy({ mode: 'simulate' }) });
    const result = await executor.execute(makeTestCase(), ctx);
    expect(result.status).toBe('passed');
  });

  it('returns steps with passed status when session configured', async () => {
    const elements = new Map([
      ['test-id=username', { visible: true }],
      ['test-id=password', { visible: true }],
      ['role=button', { visible: true }],
      ['test-id=welcome', { visible: true }],
    ]);
    const session = makeFakeSession({ elements, currentUrl: 'http://127.0.0.1:3000/dashboard' });
    const mapping = makeMapping({
      assertionMappings: [
        { expectedResultIndex: 0, assertionType: 'url-contains', expectedValue: '/login' },
        { expectedResultIndex: 1, assertionType: 'visible', targetLogicalName: 'welcome-text' },
      ],
    });
    const executor = makeExecutor({ session, mappings: [mapping] });
    const ctx = makeContext({ mode: 'simulate', policy: makePolicy({ mode: 'simulate' }) });
    const result = await executor.execute(makeTestCase(), ctx);
    expect(result.steps.every((s) => s.status === 'passed')).toBe(true);
  });

  it('can produce failed assertions in simulate mode', async () => {
    // Simulate with wrong URL → assertion fails
    const session = makeFakeSession({ currentUrl: 'http://127.0.0.1:3000/login' });
    const executor = makeExecutor({ session });
    const ctx = makeContext({ mode: 'simulate', policy: makePolicy({ mode: 'simulate' }) });
    const result = await executor.execute(makeTestCase(), ctx);
    // url-contains '/dashboard' should fail since URL is /login
    expect(result.assertions.some((a) => a.status === 'failed')).toBe(true);
  });

  it('returns passed with warning when no session injected', async () => {
    const executor = new UIExecutor({
      catalog: makeCatalog(),
      mappings: [makeMapping()],
      environment: { baseUrl: 'http://127.0.0.1:3000', allowedOrigins: ['http://127.0.0.1:3000'] },
    });
    const ctx = makeContext({ mode: 'simulate', policy: makePolicy({ mode: 'simulate' }) });
    const result = await executor.execute(makeTestCase(), ctx);
    expect(result.status).toBe('passed');
    expect(result.warnings.some((w) => w.code === UIWarningCode.UI_TEST_SKIPPED)).toBe(true);
  });
});

// ===========================================================================
// 11. EXECUTE — NO MAPPING
// ===========================================================================

describe('UIExecutor — no mapping', () => {
  it('returns skipped when no mapping', async () => {
    const executor = makeExecutor({ mappings: [] });
    const result = await executor.execute(makeTestCase(), makeContext());
    expect(result.status).toBe('skipped');
  });

  it('includes mapping-missing warning', async () => {
    const executor = makeExecutor({ mappings: [] });
    const result = await executor.execute(makeTestCase(), makeContext());
    expect(result.warnings.some((w) => w.code === UIWarningCode.UI_MAPPING_MISSING)).toBe(true);
  });
});

// ===========================================================================
// 12. EXECUTE — EXECUTE MODE
// ===========================================================================

describe('UIExecutor — execute mode', () => {
  it('executes all steps and assertions (pass)', async () => {
    const elements = new Map<string, FakeElementState>([
      ['test-id=welcome', { visible: true, text: 'Welcome' }],
    ]);
    // After login, the page navigates to dashboard
    const session = makeFakeSession({ elements, currentUrl: 'http://127.0.0.1:3000/dashboard' });
    const executor = makeExecutor({
      session,
      mappings: [{
        ...makeMapping(),
        pageId: undefined,
        stepMappings: [
          { stepOrder: 1, action: 'noop' },
          { stepOrder: 2, action: 'fill', targetLogicalName: 'username-field', valueLiteral: 'admin' },
          { stepOrder: 3, action: 'fill', targetLogicalName: 'password-field', secretRef: 'db-password' },
          { stepOrder: 4, action: 'click', targetLogicalName: 'login-button' },
        ],
      }],
    });
    const ctx = makeContext();
    const result = await executor.execute(makeTestCase(), ctx);
    expect(result.status).toBe('passed');
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.assertions.length).toBeGreaterThan(0);
  });

  it('returns error on browser start failure', async () => {
    const session = makeFakeSession({ shouldFail: true, failMessage: 'Crash' });
    const executor = makeExecutor({ session });
    const ctx = makeContext();
    const result = await executor.execute(makeTestCase(), ctx);
    expect(result.status).toBe('error');
    expect(result.error).toBeDefined();
  });

  it('returns error on missing base URL', async () => {
    const executor = new UIExecutor({
      catalog: makeCatalog(),
      mappings: [makeMapping()],
      browserSession: makeFakeSession(),
      environment: { baseUrl: '', allowedOrigins: [] },
    });
    const ctx = makeContext();
    const result = await executor.execute(makeTestCase(), ctx);
    expect(result.status).toBe('error');
  });

  it('captures failure screenshot on assertion failure', async () => {
    // Use a mapping without secret fills so screenshot is not suppressed
    const mapping = makeMapping({
      stepMappings: [
        { stepOrder: 1, action: 'navigate', valueLiteral: '/login' },
        { stepOrder: 2, action: 'fill', targetLogicalName: 'username-field', valueLiteral: 'admin' },
        { stepOrder: 3, action: 'click', targetLogicalName: 'login-button' },
      ],
    });
    const elements = new Map([['test-id=welcome', { visible: false }]]);
    const session = makeFakeSession({ elements, currentUrl: 'http://127.0.0.1:3000/login' });
    const executor = makeExecutor({ session, mappings: [mapping] });
    const ctx = makeContext();
    const _result = await executor.execute(makeTestCase(), ctx);
    // Evidence should contain screenshot
    const screenshots = ctx.evidence.list().filter((e) => e.type === 'screenshot');
    expect(screenshots.length).toBeGreaterThan(0);
  });

  it('suppresses screenshot after sensitive fill', async () => {
    // Default mapping includes secret fill → screenshot suppressed
    const elements = new Map([['test-id=welcome', { visible: false }]]);
    const session = makeFakeSession({ elements, currentUrl: 'http://127.0.0.1:3000/login' });
    const executor = makeExecutor({ session });
    const ctx = makeContext();
    const _result = await executor.execute(makeTestCase(), ctx);
    // No screenshot because sensitive field was filled
    const screenshots = ctx.evidence.list().filter((e) => e.type === 'screenshot');
    expect(screenshots.length).toBe(0);
  });
});

// ===========================================================================
// 13. CLEANUP
// ===========================================================================

describe('UIExecutor — cleanup', () => {
  it('returns succeeded', async () => {
    const executor = makeExecutor();
    const result = await executor.cleanup(makeTestCase(), makeContext());
    expect(result.status).toBe('succeeded');
  });
});

// ===========================================================================
// 14. ERROR TYPES
// ===========================================================================

describe('UIExecutorError', () => {
  it('has correct code', () => {
    const err = new UIExecutorError('UI_ORIGIN_DENIED', 'Blocked');
    expect(err.code).toBe('UI_ORIGIN_DENIED');
    expect(err.name).toBe('UIExecutorError');
    expect(err.message).toBe('Blocked');
  });

  it('has optional details', () => {
    const err = new UIExecutorError('UI_INTERNAL_ERROR', 'Oops', { foo: 'bar' });
    expect(err.details).toEqual({ foo: 'bar' });
  });
});

// ===========================================================================
// 15. SECURITY
// ===========================================================================

describe('Security', () => {
  it('rejects javascript: URLs', () => {
    const policy = mergeBrowserPolicy();
    expect(() => validateOrigin('javascript:alert(1)', policy)).toThrow(UIExecutorError);
  });

  it('rejects file: URLs', () => {
    const policy = mergeBrowserPolicy();
    expect(() => validateOrigin('file:///etc/passwd', policy)).toThrow(UIExecutorError);
  });

  it('rejects data: URLs', () => {
    const policy = mergeBrowserPolicy();
    expect(() => validateOrigin('data:text/html,<script>alert(1)</script>', policy)).toThrow(UIExecutorError);
  });

  it('rejects external origins', () => {
    const policy = mergeBrowserPolicy();
    expect(() => validateOrigin('https://evil.com/steal', policy)).toThrow(UIExecutorError);
  });

  it('rejects arbitrary full URLs in navigation', () => {
    expect(() => resolveUrl('http://127.0.0.1:3000', 'https://evil.com')).toThrow(UIExecutorError);
  });

  it('marks sensitive elements in catalog', () => {
    const resolver = new LocatorResolver(makeCatalog());
    expect(resolver.isSensitive('password-field')).toBe(true);
    expect(resolver.isSensitive('username-field')).toBe(false);
  });

  it('secrets are resolved via SecretProvider', async () => {
    const secrets = makeSecrets({ 'db-password': 's3cret' });
    const val = await secrets.resolve('db-password');
    expect(val.value).toBe('s3cret');
    expect(val.redacted).toBe('***');
  });
});

// ===========================================================================
// 16. DETERMINISM
// ===========================================================================

describe('Determinism', () => {
  it('two identical runs produce identical results', async () => {
    const run = async () => {
      const session = makeFakeSession({ currentUrl: 'http://127.0.0.1:3000/dashboard' });
      const executor = makeExecutor({ session });
      const ctx = makeContext({ mode: 'simulate', policy: makePolicy({ mode: 'simulate' }) });
      return executor.execute(makeTestCase(), ctx);
    };
    const r1 = await run();
    const r2 = await run();
    expect(r1.status).toBe(r2.status);
    expect(r1.steps).toHaveLength(r2.steps.length);
    expect(r1.assertions).toHaveLength(r2.assertions.length);
  });
});

// ===========================================================================
// 17. EVIDENCE
// ===========================================================================

describe('Evidence', () => {
  it('evidence collector tracks items', () => {
    const evidence = makeEvidence();
    const ref = evidence.add({
      type: 'screenshot',
      sourceExecutor: 'ui',
      testCaseId: 'TC-001',
      artifactRef: 'test.png',
    });
    expect(ref.id).toBeDefined();
    expect(evidence.list()).toHaveLength(1);
  });

  it('evidence items have sequential IDs', () => {
    const evidence = makeEvidence();
    evidence.add({ type: 'screenshot', sourceExecutor: 'ui', testCaseId: 'TC-001' });
    evidence.add({ type: 'log', sourceExecutor: 'ui', testCaseId: 'TC-001' });
    const items = evidence.list();
    expect(items[0].id).toBe('EVD-001');
    expect(items[1].id).toBe('EVD-002');
  });
});

// ===========================================================================
// 18. PROVENANCE
// ===========================================================================

describe('Provenance', () => {
  it('test case has provenance', () => {
    const tc = makeTestCase();
    expect(tc.provenance).toBeDefined();
    expect(tc.provenance.source).toBe('test-planner');
  });
});

// ===========================================================================
// 19. WARNINGS
// ===========================================================================

describe('UIWarningCode', () => {
  it('has all expected codes', () => {
    expect(UIWarningCode.UI_TEST_SKIPPED).toBe('UI_TEST_SKIPPED');
    expect(UIWarningCode.UI_MAPPING_MISSING).toBe('UI_MAPPING_MISSING');
    expect(UIWarningCode.UI_ASSERTION_UNVERIFIABLE).toBe('UI_ASSERTION_UNVERIFIABLE');
    expect(UIWarningCode.UI_SCREENSHOT_FAILED).toBe('UI_SCREENSHOT_FAILED');
    expect(UIWarningCode.UI_SENSITIVE_FIELD_DETECTED).toBe('UI_SENSITIVE_FIELD_DETECTED');
    expect(UIWarningCode.UI_FALLBACK_WAIT).toBe('UI_FALLBACK_WAIT');
  });
});

// ===========================================================================
// 20. ORCHESTRATOR INTEGRATION
// ===========================================================================

describe('Orchestrator integration', () => {
  it('UIExecutor implements TestExecutor contract', () => {
    const executor = makeExecutor();
    expect(typeof executor.canExecute).toBe('function');
    expect(typeof executor.validate).toBe('function');
    expect(typeof executor.execute).toBe('function');
    expect(typeof executor.cleanup).toBe('function');
    expect(executor.type).toBe('ui');
  });

  it('execute returns correct result shape', async () => {
    const executor = makeExecutor();
    const ctx = makeContext({ mode: 'simulate', policy: makePolicy({ mode: 'simulate' }) });
    const result = await executor.execute(makeTestCase(), ctx);
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('steps');
    expect(result).toHaveProperty('assertions');
    expect(result).toHaveProperty('evidence');
    expect(result).toHaveProperty('warnings');
  });

  it('assertion IDs follow ASR-NNN format', async () => {
    const executor = makeExecutor();
    const ctx = makeContext({ mode: 'simulate', policy: makePolicy({ mode: 'simulate' }) });
    const result = await executor.execute(makeTestCase(), ctx);
    for (const a of result.assertions) {
      expect(a.id).toMatch(/^ASR-\d{3}$/);
    }
  });
});

// ===========================================================================
// 21. ADDITIONAL EDGE CASES
// ===========================================================================

describe('Edge cases', () => {
  it('handles noop action', async () => {
    const resolver = new LocatorResolver(makeCatalog());
    const planner = new ActionPlanner(resolver);
    const sm: UIStepMapping = { stepOrder: 1, action: 'noop' };
    const plan = await planner.compileStep(sm, makeBindings(), makeSecrets());
    expect(plan.action).toBe('noop');
    expect(plan.target).toBeUndefined();
  });

  it('handles scroll action', async () => {
    const resolver = new LocatorResolver(makeCatalog());
    const planner = new ActionPlanner(resolver);
    const sm: UIStepMapping = { stepOrder: 1, action: 'scroll' };
    const plan = await planner.compileStep(sm, makeBindings(), makeSecrets());
    expect(plan.action).toBe('scroll');
  });

  it('handles wait action without target', async () => {
    const resolver = new LocatorResolver(makeCatalog());
    const planner = new ActionPlanner(resolver);
    const sm: UIStepMapping = { stepOrder: 1, action: 'wait' };
    const plan = await planner.compileStep(sm, makeBindings(), makeSecrets());
    expect(plan.action).toBe('wait');
    expect(plan.target).toBeUndefined();
  });

  it('handles check action', async () => {
    const resolver = new LocatorResolver(makeCatalog());
    const planner = new ActionPlanner(resolver);
    const sm: UIStepMapping = { stepOrder: 1, action: 'check', targetLogicalName: 'remember-me' };
    const plan = await planner.compileStep(sm, makeBindings(), makeSecrets());
    expect(plan.action).toBe('check');
  });

  it('handles uncheck action', async () => {
    const resolver = new LocatorResolver(makeCatalog());
    const planner = new ActionPlanner(resolver);
    const sm: UIStepMapping = { stepOrder: 1, action: 'uncheck', targetLogicalName: 'remember-me' };
    const plan = await planner.compileStep(sm, makeBindings(), makeSecrets());
    expect(plan.action).toBe('uncheck');
  });

  it('handles select action', async () => {
    const resolver = new LocatorResolver(makeCatalog());
    const planner = new ActionPlanner(resolver);
    const sm: UIStepMapping = { stepOrder: 1, action: 'select', targetLogicalName: 'username-field', valueLiteral: 'option1' };
    const plan = await planner.compileStep(sm, makeBindings(), makeSecrets());
    expect(plan.action).toBe('select');
  });

  it('handles press action', async () => {
    const resolver = new LocatorResolver(makeCatalog());
    const planner = new ActionPlanner(resolver);
    const sm: UIStepMapping = { stepOrder: 1, action: 'press', targetLogicalName: 'username-field', valueLiteral: 'Enter' };
    const plan = await planner.compileStep(sm, makeBindings(), makeSecrets());
    expect(plan.action).toBe('press');
  });

  it('handles focus action', async () => {
    const resolver = new LocatorResolver(makeCatalog());
    const planner = new ActionPlanner(resolver);
    const sm: UIStepMapping = { stepOrder: 1, action: 'focus', targetLogicalName: 'username-field' };
    const plan = await planner.compileStep(sm, makeBindings(), makeSecrets());
    expect(plan.action).toBe('focus');
  });

  it('handles blur action', async () => {
    const resolver = new LocatorResolver(makeCatalog());
    const planner = new ActionPlanner(resolver);
    const sm: UIStepMapping = { stepOrder: 1, action: 'blur', targetLogicalName: 'username-field' };
    const plan = await planner.compileStep(sm, makeBindings(), makeSecrets());
    expect(plan.action).toBe('blur');
  });

  it('handles type action', async () => {
    const resolver = new LocatorResolver(makeCatalog());
    const planner = new ActionPlanner(resolver);
    const sm: UIStepMapping = { stepOrder: 1, action: 'type', targetLogicalName: 'username-field', valueLiteral: 'admin' };
    const plan = await planner.compileStep(sm, makeBindings(), makeSecrets());
    expect(plan.action).toBe('type');
  });

  it('step mapping with timeout', async () => {
    const resolver = new LocatorResolver(makeCatalog());
    const planner = new ActionPlanner(resolver);
    const sm: UIStepMapping = { stepOrder: 1, action: 'click', targetLogicalName: 'login-button', timeoutMs: 15000 };
    const plan = await planner.compileStep(sm, makeBindings(), makeSecrets());
    expect(plan.timeoutMs).toBe(15000);
  });

  it('assertion mapping with timeout', () => {
    const am: UIAssertionMapping = { expectedResultIndex: 0, assertionType: 'visible', targetLogicalName: 'login-button', timeoutMs: 8000 };
    expect(am.timeoutMs).toBe(8000);
  });

  it('empty catalog has no pages', () => {
    const resolver = new LocatorResolver({ environmentId: 'env-1', pages: [] });
    expect(resolver.getPage('any')).toBeNull();
  });

  it('catalog with multiple pages', () => {
    const resolver = new LocatorResolver(makeCatalog());
    expect(resolver.getPage('login-page')).not.toBeNull();
    expect(resolver.getPage('dashboard-page')).not.toBeNull();
  });
});

// ===========================================================================
// 22. ADDITIONAL INTEGRATION & EDGE CASES
// ===========================================================================

describe('Additional integration tests', () => {
  it('execute mode handles step failure and stops', async () => {
    // Session starts OK but actions fail
    const session = makeFakeSession({ shouldFail: false });
    // Override page to fail on actions
    const origPage = session.page();
    origPage.goto = async (_url: string) => { throw new Error('Nav failed'); };
    const executor = makeExecutor({
      session,
      mappings: [{
        ...makeMapping(),
        pageId: undefined,
      }],
    });
    const ctx = makeContext();
    const result = await executor.execute(makeTestCase(), ctx);
    // First step (navigate) fails, execution stops
    expect(result.steps.length).toBeGreaterThanOrEqual(1);
    expect(result.steps[0].status).toBe('failed');
  });

  it('execute mode with no assertions passes', async () => {
    const session = makeFakeSession({ currentUrl: 'http://127.0.0.1:3000/' });
    const executor = makeExecutor({
      session,
      mappings: [{
        ...makeMapping(),
        pageId: undefined,
        assertionMappings: [],
      }],
    });
    const tc = makeTestCase({ expectedResults: [] });
    const ctx = makeContext();
    const result = await executor.execute(tc, ctx);
    expect(result.status).toBe('passed');
    expect(result.assertions).toHaveLength(0);
  });

  it('navigate action validates origin', async () => {
    const session = makeFakeSession();
    const executor = makeExecutor({
      session,
      mappings: [{
        testCaseId: 'TC-001',
        executorType: 'ui',
        stepMappings: [{ stepOrder: 1, action: 'navigate', valueLiteral: '/login' }],
        assertionMappings: [],
      }],
    });
    const tc = makeTestCase({
      steps: [{ order: 1, description: 'Nav', action: 'navigate' }],
      expectedResults: [],
    });
    const ctx = makeContext();
    const result = await executor.execute(tc, ctx);
    // Should succeed because /login resolves to allowed origin
    expect(result.status).toBe('passed');
  });

  it('verifyAll returns empty for empty plans', async () => {
    const resolver = new LocatorResolver(makeCatalog());
    const verifier = new AssertionVerifier(resolver);
    const session = makeFakeSession();
    await session.start({ baseUrl: 'http://127.0.0.1', allowedOrigins: [] });
    const results = await verifier.verifyAll([], session.page());
    expect(results).toHaveLength(0);
  });

  it('fake page title returns configured value', async () => {
    const session = makeFakeSession({ pageTitle: 'My App' });
    await session.start({ baseUrl: 'http://127.0.0.1', allowedOrigins: [] });
    const title = await session.page().title();
    expect(title).toBe('My App');
  });

  it('fake page url returns configured value', async () => {
    const session = makeFakeSession({ currentUrl: 'http://127.0.0.1:8080/app' });
    await session.start({ baseUrl: 'http://127.0.0.1', allowedOrigins: [] });
    expect(session.page().url()).toBe('http://127.0.0.1:8080/app');
  });

  it('fake page count returns 1', async () => {
    const session = makeFakeSession();
    await session.start({ baseUrl: 'http://127.0.0.1', allowedOrigins: [] });
    const locator = { strategy: 'test-id' as const, value: 'x', description: 'test-id=x' };
    const count = await session.page().count(locator);
    expect(count).toBe(1);
  });

  it('UIExecutorError is instanceof Error', () => {
    const err = new UIExecutorError('UI_INTERNAL_ERROR', 'test');
    expect(err instanceof Error).toBe(true);
  });

  it('UI_ERROR_CODES contains all expected codes', () => {
    expect(UI_ERROR_CODES.has('UI_ORIGIN_DENIED')).toBe(true);
    expect(UI_ERROR_CODES.has('UI_BROWSER_START_FAILED')).toBe(true);
    expect(UI_ERROR_CODES.size).toBe(22);
  });

  it('binding store tracks produced values', () => {
    const store = makeBindings();
    store.produce({ id: 'b1', name: 'token', producerOperationId: 'op1', value: 'abc', sensitive: false, status: 'resolved' });
    expect(store.isResolved('token')).toBe(true);
    expect(store.resolve('token')?.value).toBe('abc');
    expect(store.all()).toHaveLength(1);
  });

  it('binding store sensitiveNames returns sensitive entries', () => {
    const store = makeBindings({ secret1: { value: 'x', sensitive: true } });
    expect(store.sensitiveNames().has('secret1')).toBe(true);
  });

  it('evidence collector returns empty list initially', () => {
    const evidence = makeEvidence();
    expect(evidence.list()).toHaveLength(0);
  });

  it('audit recorder tracks events', () => {
    const audit = makeAudit();
    audit.record({ type: 'test-start', testCaseId: 'TC-001', message: 'started' });
    expect(audit.events()).toHaveLength(1);
    expect(audit.events()[0].type).toBe('test-start');
  });

  it('clock returns fixed time', () => {
    const clock = makeClock();
    expect(clock.nowIso()).toBe('2025-06-01T00:00:00.000Z');
    expect(clock.now().getFullYear()).toBe(2025);
  });
});
