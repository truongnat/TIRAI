// Test fixtures for Execution Mapping Builder tests.
//
// Provides reusable TestCase, UIElementCatalog, and BindingsCatalog fixtures.

import type {
  TestCase,
  UIElementCatalog,
  BindingsCatalog,
  SemanticEntity,
} from '../src/models.js';

// ---- Minimal TestCase factory ----------------------------------------------

export function makeTestCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    id: 'TC-0001',
    scenarioId: 'SC-001',
    requirementIds: ['REQ-001'],
    title: 'Test case',
    objective: 'Test objective',
    type: 'unknown',
    priority: 'medium',
    preconditions: [],
    inputs: [],
    dataNeeds: [],
    steps: [],
    expectedResults: [],
    cleanup: [],
    automation: { status: 'unknown', reasons: [] },
    provenance: [{ requirementId: 'REQ-001' }],
    confidence: 0.5,
    ...overrides,
  };
}

// ---- Login test case -------------------------------------------------------

export function makeLoginTestCase(): TestCase {
  return makeTestCase({
    id: 'TC-0001',
    title: 'Successful login',
    type: 'ui',
    automation: { status: 'ready', suggestedExecutor: 'ui', reasons: [] },
    steps: [
      { order: 1, action: 'Navigate to login page', target: 'login-page' },
      { order: 2, action: 'Enter username', target: 'username-field', input: 'runtime.username' },
      { order: 3, action: 'Enter password', target: 'password-field', input: 'runtime.password' },
      { order: 4, action: 'Click login button', target: 'login-button' },
    ],
    expectedResults: [
      { description: 'Dashboard is displayed', verificationType: 'ui', target: 'dashboard-marker' },
      { description: 'URL contains /dashboard', verificationType: 'ui' },
    ],
  });
}

// ---- Login catalog ---------------------------------------------------------

export function makeLoginCatalog(): UIElementCatalog {
  return {
    environmentId: 'test-env',
    pages: [
      {
        id: 'login-page',
        route: '/login',
        elements: [
          { logicalName: 'username-field', locator: { strategy: 'test-id', value: 'username' } },
          { logicalName: 'password-field', locator: { strategy: 'test-id', value: 'password' }, sensitive: true },
          { logicalName: 'login-button', locator: { strategy: 'test-id', value: 'login-btn' } },
          { logicalName: 'error-message', locator: { strategy: 'test-id', value: 'error-msg' } },
        ],
      },
      {
        id: 'dashboard-page',
        route: '/dashboard',
        elements: [
          { logicalName: 'dashboard-marker', locator: { strategy: 'test-id', value: 'dashboard' } },
          { logicalName: 'welcome-text', locator: { strategy: 'test-id', value: 'welcome' } },
        ],
      },
    ],
  };
}

// ---- Bindings catalog ------------------------------------------------------

export function makeBindingsCatalog(): BindingsCatalog {
  return {
    bindings: [
      { name: 'runtime.username', type: 'runtime' },
      { name: 'runtime.password', type: 'secret' },
      { name: 'runtime.token', type: 'runtime' },
    ],
  };
}

// ---- Duplicate elements catalog (for ambiguity testing) --------------------

export function makeDuplicateCatalog(): UIElementCatalog {
  return {
    environmentId: 'test-env',
    pages: [
      {
        id: 'page-1',
        elements: [
          { logicalName: 'item', locator: { strategy: 'test-id', value: 'item-1' } },
          { logicalName: 'item', locator: { strategy: 'test-id', value: 'item-2' } },
        ],
      },
    ],
  };
}

// ---- Semantic entities ------------------------------------------------------

export function makeSemanticEntities(): SemanticEntity[] {
  return [
    { id: 'SE-1', type: 'ui-component', name: 'LoginForm' },
    { id: 'SE-2', type: 'page-object', name: 'DashboardPage' },
    { id: 'SE-3', type: 'api', name: 'AuthAPI' },
    { id: 'SE-4', type: 'db-table', name: 'users' },
  ];
}

// ---- API test case ---------------------------------------------------------

export function makeApiTestCase(): TestCase {
  return makeTestCase({
    id: 'TC-API-001',
    title: 'API authentication',
    type: 'api',
    automation: { status: 'ready', suggestedExecutor: 'api', reasons: [] },
    steps: [
      { order: 1, action: 'Send POST request to /api/auth', target: 'auth-endpoint' },
    ],
    expectedResults: [
      { description: 'Response status is 200', verificationType: 'api' },
    ],
  });
}

// ---- Database test case ----------------------------------------------------

export function makeDbTestCase(): TestCase {
  return makeTestCase({
    id: 'TC-DB-001',
    title: 'Column allows NULL',
    type: 'database',
    automation: { status: 'ready', suggestedExecutor: 'database', reasons: [] },
    steps: [
      { order: 1, action: 'Insert NULL into column', target: 'users.status' },
    ],
    expectedResults: [
      { description: 'Insert succeeds', verificationType: 'database' },
    ],
  });
}

// ---- Manual test case ------------------------------------------------------

export function makeManualTestCase(): TestCase {
  return makeTestCase({
    id: 'TC-MANUAL-001',
    title: 'Visual inspection',
    type: 'manual',
    automation: { status: 'manual-only', reasons: ['Visual check'] },
    steps: [
      { order: 1, action: 'Observe the screen' },
    ],
    expectedResults: [
      { description: 'Layout looks correct', verificationType: 'other' },
    ],
  });
}
