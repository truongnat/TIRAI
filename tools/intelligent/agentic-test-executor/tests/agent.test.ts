// ---------------------------------------------------------------------------
// Agent loop tests — AgenticTestExecutor with deterministic grounding
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import type { BrowserSession } from 'ui-executor';
import type { TestDataItem } from 'test-data-planner';
import { AgenticTestExecutor } from '../src/agent.js';
import { defaultCapabilities, type AgentCapabilities, type BrowserObservation } from '../src/models.js';
import type {
  RuntimeCapabilityInventory,
  RuntimePreparationAdapter,
} from '../src/data/runtime-capability-inventory.js';
import {
  createFakePage,
  createFakeBrowserSession,
  makeTestCase,
  makeContext,
  loginPageObservation,
  dashboardObservation,
  errorLoginObservation,
  type FakePageState,
} from './fixtures/helpers.js';

function buildExecutor(opts: {
  observationSequence?: BrowserObservation[];
  capabilityInventory?: Partial<RuntimeCapabilityInventory>;
  capabilities?: AgentCapabilities;
  testDataItems?: TestDataItem[];
}) {
  const obsSequence = opts.observationSequence ?? [loginPageObservation(), dashboardObservation()];
  let obsIndex = 0;

  const state: FakePageState = {
    url: 'http://127.0.0.1:3000/login',
    title: 'Login',
    observation: obsSequence[0]!,
    clickedElements: [],
    filledElements: [],
    gotoCalls: [],
  };

  const page = createFakePage(state);
  page.evaluate = async <T>(_expr: string): Promise<T> => {
    const observation = obsSequence[Math.min(obsIndex, obsSequence.length - 1)]!;
    obsIndex++;
    const raw = {
      url: observation.url,
      title: observation.title,
      headings: observation.headings,
      pageText: observation.pageText,
      elements: observation.elements.map((el) => ({
        tag: 'button',
        role: el.role,
        accessibleName: el.accessibleName,
        label: el.label,
        placeholder: el.placeholder,
        inputType: el.inputType,
        visibleText: el.visibleText,
        enabled: el.enabled,
        checked: false,
        selected: false,
        testId: el.testId,
      })),
    };
    return raw as T;
  };

  const session = createFakeBrowserSession(page);

  const executor = new AgenticTestExecutor({
    browserSession: session,
    baseUrl: 'http://127.0.0.1:3000/login',
    capabilities: opts.capabilities ?? { ...defaultCapabilities(), browser: 'AVAILABLE' },
    testDataItems: opts.testDataItems,
    capabilityInventory: opts.capabilityInventory,
    preparationPolicy: opts.preparationPolicy,
  });

  return { executor, state, session };
}

describe('AgenticTestExecutor', () => {
  describe('canExecute', () => {
    it('returns supported when browser capability available', () => {
      const { executor } = buildExecutor({});
      const match = executor.canExecute(makeTestCase(), makeContext());
      expect(match.supported).toBe(true);
      expect(match.score).toBe(0.8);
    });

    it('returns unsupported when browser capability unavailable', () => {
      const { executor } = buildExecutor({ capabilities: defaultCapabilities() });
      const match = executor.canExecute(makeTestCase(), makeContext());
      expect(match.supported).toBe(false);
      expect(match.score).toBe(0);
    });
  });

  describe('validate', () => {
    it('valid test case with steps', async () => {
      const { executor } = buildExecutor({});
      const result = await executor.validate(makeTestCase(), makeContext());
      expect(result.valid).toBe(true);
    });

    it('invalid test case with no steps', async () => {
      const { executor } = buildExecutor({});
      const tc = makeTestCase({ steps: [] });
      const result = await executor.validate(tc, makeContext());
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('execute', () => {
    it('executes a simple login flow successfully', async () => {
      const observations = [
        loginPageObservation(),
        loginPageObservation(),
        loginPageObservation(),
        dashboardObservation(),
      ];

      const { executor } = buildExecutor({ observationSequence: observations });

      const tc = makeTestCase({
        steps: [
          { order: 1, action: 'Enter "Username"', input: 'demo' },
          { order: 2, action: 'Enter "Password"', input: 'secret://login/password' },
          { order: 3, action: 'Click "Login"' },
        ],
        expectedResults: [
          { description: 'The message "Welcome, demo!" is displayed', verificationType: 'ui' },
        ],
      });

      const result = await executor.execute(tc, makeContext());
      expect(result.status).toBe('passed');
      expect(result.steps).toHaveLength(3);
      expect(result.assertions).toHaveLength(1);
      expect(result.assertions[0].status).toBe('passed');
    });

    it('prepares an API-owned fixture before browser execution and cleans it afterward', async () => {
      const prepared: string[] = [];
      const cleaned: string[] = [];
      const adapter: RuntimePreparationAdapter = {
        async prepare(request) {
          prepared.push(request.item.id);
          return {
            value: 'ORDER-123',
            ownership: 'TEST_OWNED',
            cleanupRef: 'ORDER-123',
            evidence: [{ kind: 'api', description: 'Explicit fixture API created an order binding.' }],
          };
        },
        async cleanup(request) {
          cleaned.push(request.item.id);
        },
      };
      const preparedItem: TestDataItem = {
        id: 'DATA-ORDER',
        name: 'approved-order',
        description: 'Temporary order created for this test',
        type: 'external-response',
        lifecycle: 'temporary',
        strategy: 'create-new',
        constraints: [],
        dependencies: [],
        relatedTestCaseIds: ['TC-001'],
        relatedRequirementIds: [],
        relatedEntityIds: ['Order'],
        setup: [{ type: 'create', description: 'Create through explicit API fixture operation', executorHint: 'api' }],
        cleanup: [{ type: 'delete', description: 'Delete test-owned order' }],
        provenance: [],
        confidence: 1,
      };
      const { executor, state } = buildExecutor({
        observationSequence: [
          {
            url: 'http://127.0.0.1:3000/orders',
            title: 'Orders',
            headings: ['Orders'],
            pageText: 'Orders Order ID Order ready',
            elements: [{ id: 'el-001', role: 'textbox', accessibleName: 'Order ID', enabled: true }],
            truncated: false,
          },
          {
            url: 'http://127.0.0.1:3000/orders',
            title: 'Orders',
            headings: ['Orders'],
            pageText: 'Orders Order ready',
            elements: [{ id: 'el-001', role: 'textbox', accessibleName: 'Order ID', enabled: true }],
            truncated: false,
          },
        ],
        testDataItems: [preparedItem],
        capabilityInventory: {
          environmentKind: 'test',
          environment: {
            id: 'ENV-TEST',
            resources: [{ id: 'api-test', type: 'api', name: 'Fixture API', capabilities: ['mutate'], metadata: {} }],
            capabilities: [],
          },
          api: {
            available: true,
            readable: true,
            mutable: true,
            allowedOperationIds: ['OP-DATA-ORDER'],
            preparation: adapter,
          },
        },
        preparationPolicy: { environment: 'test', allowApiCreate: true },
      });
      const result = await executor.execute(makeTestCase({
        steps: [{ order: 1, action: 'Enter "Order ID"', input: 'testdata://DATA-ORDER' }],
        expectedResults: [{ description: 'The message "Order ready" is displayed', verificationType: 'ui' }],
      }), makeContext());

      expect(result.status).toBe('passed');
      expect(state.filledElements[0]?.value).toBe('ORDER-123');
      expect(prepared).toEqual(['DATA-ORDER']);
      expect((await executor.cleanup(makeTestCase(), makeContext())).status).toBe('succeeded');
      expect(cleaned).toEqual(['DATA-ORDER']);
    });

    it('returns error when browser fails to start', async () => {
      const session = {
        start: async () => { throw new Error('Browser crashed'); },
        page: () => { throw new Error('No page'); },
        screenshot: async () => Buffer.from(''),
        close: async () => {},
        isClosed: () => true,
      };

      const executor = new AgenticTestExecutor({
        browserSession: session as unknown as BrowserSession,
        baseUrl: 'http://127.0.0.1:3000',
        capabilities: { ...defaultCapabilities(), browser: 'AVAILABLE' },
      });

      const result = await executor.execute(makeTestCase(), makeContext());
      expect(result.status).toBe('error');
      expect(result.error?.code).toBe('AGENT_BROWSER_ERROR');
    });

    it('blocks unresolved existing data before starting the browser', async () => {
      const pageState: FakePageState = {
        url: 'http://127.0.0.1:3000/login',
        title: 'Login',
        observation: loginPageObservation(),
        clickedElements: [],
        filledElements: [],
        gotoCalls: [],
      };
      const page = createFakePage(pageState);
      const baseSession = createFakeBrowserSession(page);
      let browserStarts = 0;
      const session = {
        ...baseSession,
        start: async (config: Parameters<BrowserSession['start']>[0]) => {
          browserStarts++;
          await baseSession.start(config);
        },
      } as BrowserSession;
      const executor = new AgenticTestExecutor({
        browserSession: session,
        baseUrl: 'http://127.0.0.1:3000',
        capabilities: { ...defaultCapabilities(), browser: 'AVAILABLE' },
        testDataItems: [{
          id: 'DATA-ACCOUNT-001',
          name: 'valid-username',
          description: 'Valid existing username for the login account',
          type: 'account',
          lifecycle: 'existing',
          strategy: 'reuse-existing',
          constraints: [],
          dependencies: [],
          relatedTestCaseIds: ['TC-001'],
          relatedRequirementIds: [],
          relatedEntityIds: [],
          setup: [],
          cleanup: [],
          provenance: [],
          confidence: 1,
        } as TestDataItem],
      });

      const result = await executor.execute(makeTestCase(), makeContext());

      expect(result.status).toBe('blocked');
      expect(result.error?.code).toBe('AGENT_DATA_UNRESOLVED');
      expect(browserStarts).toBe(0);
      expect(pageState.gotoCalls).toHaveLength(0);
      expect(executor.getLastMetrics().actions).toBe(0);
      expect(executor.getLastDataResolutions()[0].status).toBe('NEEDS_CAPABILITY');
      expect(executor.getLastDataResolutions()[0].value).toBeUndefined();
    });

    it('returns ERROR when an explicit discovery capability crashes', async () => {
      const { executor, state } = buildExecutor({
        testDataItems: [{
          id: 'DATA-DB-ERROR',
          name: 'existing-user',
          description: 'Existing User',
          type: 'database-record',
          lifecycle: 'existing',
          strategy: 'select-existing',
          constraints: [],
          dependencies: [],
          relatedTestCaseIds: ['TC-001'],
          relatedRequirementIds: [],
          relatedEntityIds: ['User'],
          setup: [{ type: 'select', description: 'Select User', executorHint: 'database' }],
          cleanup: [],
          provenance: [],
          confidence: 1,
        }],
        capabilityInventory: {
          environment: {
            id: 'ENV-DB',
            resources: [{ id: 'db-test', type: 'database', name: 'DB', capabilities: ['select'], metadata: {} }],
            capabilities: [],
          },
          resourceMappings: [{ logicalEntity: 'User', resourceId: 'db-test' }],
          database: {
            available: true,
            readable: true,
            writable: false,
            discovery: async () => { throw new Error('DB crashed'); },
          },
        },
      });

      const result = await executor.execute(makeTestCase(), makeContext());

      expect(result.status).toBe('error');
      expect(result.error?.code).toBe('AGENT_DATA_PREPARATION_ERROR');
      expect(state.gotoCalls).toHaveLength(0);
    });

    it('returns blocked when grounding cannot resolve the element', async () => {
      const observations = [loginPageObservation(), loginPageObservation(), loginPageObservation(), loginPageObservation()];
      const { executor } = buildExecutor({ observationSequence: observations });

      const tc = makeTestCase({
        steps: [{ order: 1, action: 'Click "Nonexistent element"' }],
        expectedResults: [],
      });

      const result = await executor.execute(tc, makeContext());
      expect(result.status).toBe('blocked');
    });

    it('returns failed when assertion contradicts', async () => {
      const observations = [loginPageObservation(), loginPageObservation()];
      const { executor } = buildExecutor({ observationSequence: observations });

      const tc = makeTestCase({
        steps: [{ order: 1, action: 'Click "Login"' }],
        expectedResults: [{ description: 'The message "This text does not exist" is displayed', verificationType: 'ui' }],
      });

      const result = await executor.execute(tc, makeContext());
      expect(result.status).toBe('failed');
      expect(result.assertions[0]?.actual).toContain('Observed page text: Login Username Password Login');
    });

    it('handles negative login (error message displayed)', async () => {
      const observations = [
        loginPageObservation(),
        loginPageObservation(),
        loginPageObservation(),
        errorLoginObservation(),
      ];
      const { executor } = buildExecutor({ observationSequence: observations });

      const tc = makeTestCase({
        steps: [
          { order: 1, action: 'Enter "Username"', input: 'demo' },
          { order: 2, action: 'Enter "Password"', input: 'wrong-password' },
          { order: 3, action: 'Click "Login"' },
        ],
        expectedResults: [
          { description: 'Error message "Invalid credentials" is displayed', verificationType: 'ui' },
        ],
      });

      const result = await executor.execute(tc, makeContext());
      expect(result.status).toBe('passed');
      expect(result.assertions[0].status).toBe('passed');
    });

    it('cleanup succeeds', async () => {
      const { executor } = buildExecutor({});
      const result = await executor.cleanup(makeTestCase(), makeContext());
      expect(result.status).toBe('succeeded');
    });
    it('refuses cleanup without a human-approved target after an isolated test session', async () => {
      const { executor, session } = buildExecutor({});
      Object.assign(session, { createIsolatedPage: async () => session.page() });
      const testCase = makeTestCase({
        steps: [],
        expectedResults: [],
        cleanup: [{ description: 'Remove the test-created record' }],
      });

      await executor.execute(testCase, makeContext());
      const result = await executor.cleanup(testCase, makeContext());

      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('AGENT_CLEANUP_TARGET_MISSING');
    });
  });
});
