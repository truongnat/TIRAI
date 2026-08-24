// ---------------------------------------------------------------------------
// Test helpers — fakes, factories, builders
// ---------------------------------------------------------------------------

import type { AIProvider, AIGenerationRequest, AIGenerationResponse } from 'ai-provider';
import type { BrowserSession, BrowserPage, ResolvedLocator, UIEnvironmentConfig } from 'ui-executor';
import type { TestCase, TestExecutionContext } from 'test-execution-orchestrator';
import type { BrowserObservation, ObservedElement, AgenticAction } from '../../src/models.js';

// ---- Fake AI Provider -----------------------------------------------------

export interface FakeAIHandler {
  (request: AIGenerationRequest): unknown;
}

export function createFakeAI(handler: FakeAIHandler): AIProvider {
  return {
    name: 'fake',
    capabilities: { structuredOutput: true, strictStructuredOutput: true, streaming: false },
    async generate<T>(request: AIGenerationRequest<T>): Promise<AIGenerationResponse<T>> {
      const data = handler(request) as T;
      return { provider: 'fake', model: 'fake-model', data };
    },
  };
}

export function createGroundingHandler(action: AgenticAction, confidence = 'high' as const) {
  return (_req: AIGenerationRequest): unknown => ({
    action,
    confidence,
    reasoning: 'test grounding',
  });
}

export function createAssertionHandler(
  assertionType: string,
  opts?: { elementId?: string; expectedValue?: string },
) {
  return (_req: AIGenerationRequest): unknown => ({
    assertionType,
    elementId: opts?.elementId,
    expectedValue: opts?.expectedValue,
    confidence: 'high',
    reasoning: 'test assertion',
  });
}

// ---- Fake Browser Page ----------------------------------------------------

export interface FakePageState {
  url: string;
  title: string;
  observation: BrowserObservation;
  clickedElements: string[];
  filledElements: Array<{ locator: ResolvedLocator; value: string }>;
  gotoCalls: string[];
}

export function createFakePage(state: FakePageState): BrowserPage {
  return {
    goto: async (url: string) => { state.url = url; state.gotoCalls.push(url); },
    click: async (target: ResolvedLocator) => { state.clickedElements.push(target.description); },
    fill: async (target: ResolvedLocator, value: string) => { state.filledElements.push({ locator: target, value }); },
    type: async () => {},
    selectOption: async () => {},
    check: async () => {},
    uncheck: async () => {},
    press: async () => {},
    focus: async () => {},
    blur: async () => {},
    waitForVisible: async () => {},
    waitForHidden: async () => {},
    isVisible: async () => true,
    isEnabled: async () => true,
    isChecked: async () => false,
    textContent: async () => '',
    inputValue: async () => '',
    attribute: async () => null,
    count: async () => 1,
    title: async () => state.title,
    url: () => state.url,
    evaluate: async <T>(_expression: string): Promise<T> => {
      const raw = {
        url: state.observation.url,
        title: state.observation.title,
        headings: state.observation.headings,
        pageText: state.observation.pageText ?? '',
        elements: state.observation.elements.map((el) => ({
          tag: 'button',
          role: el.role,
          accessibleName: el.accessibleName,
          label: el.label,
          placeholder: el.placeholder,
          inputType: el.inputType,
          visibleText: el.visibleText,
          enabled: el.enabled,
          checked: el.checked ?? false,
          selected: el.selected ?? false,
          testId: undefined,
        })),
      };
      return raw as T;
    },
  };
}

export function createFakeBrowserSession(page: BrowserPage): BrowserSession {
  let closed = false;
  return {
    start: async (_config: UIEnvironmentConfig) => {},
    page: () => page,
    screenshot: async () => Buffer.from(''),
    close: async () => { closed = true; },
    isClosed: () => closed,
  };
}

// ---- Observation builders -------------------------------------------------

export function makeElement(overrides: Partial<ObservedElement> & { id: string }): ObservedElement {
  return {
    role: 'button',
    enabled: true,
    ...overrides,
  };
}

export function makeObservation(overrides: Partial<BrowserObservation> = {}): BrowserObservation {
  return {
    url: 'http://127.0.0.1:3000/login',
    title: 'Login',
    headings: ['Login'],
    elements: [],
    pageText: 'Login Username Password Login',
    truncated: false,
    ...overrides,
  };
}

// ---- Test case factories --------------------------------------------------

export function makeTestCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    id: 'TC-001',
    scenarioId: 'SC-001',
    requirementIds: ['REQ-001'],
    title: 'Test case',
    objective: 'Test something',
    type: 'functional',
    priority: 'medium',
    preconditions: [],
    inputs: [],
    dataNeeds: [],
    steps: [
      { order: 1, action: 'Click login button' },
    ],
    expectedResults: [
      { description: 'Dashboard is shown', verificationType: 'ui' },
    ],
    cleanup: [],
    automation: { status: 'ready', suggestedExecutor: 'ui', reasons: [] },
    provenance: [],
    confidence: 0.9,
    ...overrides,
  } as TestCase;
}

export function makeContext(): TestExecutionContext {
  return {
    mode: 'dry-run',
    policy: { maxRetries: 0, timeoutMs: 30000, parallelism: 1, stopOnFailure: false },
    bindings: { get: () => undefined, set: () => {}, getAll: () => ({}) } as unknown as TestExecutionContext['bindings'],
    secrets: {} as unknown as TestExecutionContext['secrets'],
    evidence: { collect: async () => ({ id: 'EV-001', type: 'screenshot', location: '', hash: '' }) } as unknown as TestExecutionContext['evidence'],
    audit: { record: async () => {} } as unknown as TestExecutionContext['audit'],
    clock: { now: () => new Date('2025-01-01T00:00:00Z').toISOString() },
    runId: 'RUN-001',
    testCaseId: 'TC-001',
    environmentId: 'ENV-001',
  } as unknown as TestExecutionContext;
}

// ---- Login page observation -----------------------------------------------

export function loginPageObservation(): BrowserObservation {
  return {
    url: 'http://127.0.0.1:3000/login',
    title: 'Login',
    headings: ['Login'],
    pageText: 'Login Username Password Login',
    elements: [
      { id: 'el-001', role: 'textbox', accessibleName: 'Username', placeholder: 'Username', inputType: 'text', enabled: true },
      { id: 'el-002', role: 'textbox', accessibleName: 'Password', placeholder: 'Password', inputType: 'password', enabled: true },
      { id: 'el-003', role: 'button', accessibleName: 'Login', visibleText: 'Login', enabled: true },
    ],
    truncated: false,
  };
}

export function dashboardObservation(): BrowserObservation {
  return {
    url: 'http://127.0.0.1:3000/dashboard',
    title: 'Dashboard',
    headings: ['Welcome, demo!'],
    pageText: 'Welcome, demo! Logout',
    elements: [
      { id: 'el-001', role: 'button', accessibleName: 'Logout', visibleText: 'Logout', enabled: true },
    ],
    truncated: false,
  };
}

export function errorLoginObservation(): BrowserObservation {
  return {
    url: 'http://127.0.0.1:3000/login',
    title: 'Login',
    headings: ['Login'],
    pageText: 'Login Username Password Login Invalid credentials',
    elements: [
      { id: 'el-001', role: 'textbox', accessibleName: 'Username', placeholder: 'Username', inputType: 'text', enabled: true },
      { id: 'el-002', role: 'textbox', accessibleName: 'Password', placeholder: 'Password', inputType: 'password', enabled: true },
      { id: 'el-003', role: 'button', accessibleName: 'Login', visibleText: 'Login', enabled: true },
      { id: 'el-004', role: 'generic', visibleText: 'Invalid credentials', enabled: true },
    ],
    truncated: false,
  };
}
