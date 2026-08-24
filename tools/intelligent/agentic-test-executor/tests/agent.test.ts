// ---------------------------------------------------------------------------
// Agent loop tests — AgenticTestExecutor with fakes
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import type { BrowserSession } from 'ui-executor';
import { AgenticTestExecutor } from '../src/agent.js';
import { defaultCapabilities, type BrowserObservation } from '../src/models.js';
import {
  createFakeAI,
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
  ai: ReturnType<typeof createFakeAI>;
  observationSequence?: BrowserObservation[];
  capabilities?: ReturnType<typeof defaultCapabilities>;
}) {
  const obsSequence = opts.observationSequence ?? [loginPageObservation(), dashboardObservation()];
  let obsIndex = 0;

  const state: FakePageState = {
    url: 'http://127.0.0.1:3000/login',
    title: 'Login',
    observation: obsSequence[0],
    clickedElements: [],
    filledElements: [],
    gotoCalls: [],
  };

  const page = createFakePage(state);
  page.evaluate = async <T>(_expr: string): Promise<T> => {
    const currentObs = obsSequence[Math.min(obsIndex, obsSequence.length - 1)];
    obsIndex++;
    const raw = {
      url: currentObs.url,
      title: currentObs.title,
      headings: currentObs.headings,
      pageText: currentObs.pageText ?? '',
      elements: currentObs.elements.map((el) => ({
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
  };

  const session = createFakeBrowserSession(page);

  const executor = new AgenticTestExecutor({
    browserSession: session,
    aiProvider: opts.ai,
    baseUrl: 'http://127.0.0.1:3000',
    capabilities: opts.capabilities ?? { ...defaultCapabilities(), browser: 'AVAILABLE' },
    allowedOrigins: ['http://127.0.0.1'],
  });

  return { executor, state, session };
}

describe('AgenticTestExecutor', () => {
  describe('canExecute', () => {
    it('returns supported when browser capability available', () => {
      const { executor } = buildExecutor({
        ai: createFakeAI(() => ({})),
      });
      const match = executor.canExecute(makeTestCase(), makeContext());
      expect(match.supported).toBe(true);
      expect(match.score).toBe(0.8);
    });

    it('returns unsupported when browser capability unavailable', () => {
      const { executor } = buildExecutor({
        ai: createFakeAI(() => ({})),
        capabilities: defaultCapabilities(),
      });
      const match = executor.canExecute(makeTestCase(), makeContext());
      expect(match.supported).toBe(false);
      expect(match.score).toBe(0);
    });
  });

  describe('validate', () => {
    it('valid test case with steps', async () => {
      const { executor } = buildExecutor({ ai: createFakeAI(() => ({})) });
      const result = await executor.validate(makeTestCase(), makeContext());
      expect(result.valid).toBe(true);
    });

    it('invalid test case with no steps', async () => {
      const { executor } = buildExecutor({ ai: createFakeAI(() => ({})) });
      const tc = makeTestCase({ steps: [] });
      const result = await executor.validate(tc, makeContext());
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('execute', () => {
    it('executes a simple login flow successfully', async () => {
      let callCount = 0;
      const ai = createFakeAI((_req) => {
        callCount++;
        if (callCount <= 3) {
          const actions: AgenticAction[] = [
            { type: 'fill', elementId: 'el-001', value: 'demo' },
            { type: 'fill', elementId: 'el-002', value: 'secret://login/password' },
            { type: 'click', elementId: 'el-003' },
          ];
          return { action: actions[callCount - 1], confidence: 'high', reasoning: 'test' };
        }
        return {
          assertionType: 'text-visible',
          expectedValue: 'Welcome, demo!',
          confidence: 'high',
          reasoning: 'test',
        };
      });

      const observations = [
        loginPageObservation(),
        loginPageObservation(),
        loginPageObservation(),
        dashboardObservation(),
      ];

      const { executor } = buildExecutor({ ai, observationSequence: observations });

      const tc = makeTestCase({
        steps: [
          { order: 1, action: 'Enter username', input: 'demo' },
          { order: 2, action: 'Enter password', input: 'secret://login/password' },
          { order: 3, action: 'Click login button' },
        ],
        expectedResults: [
          { description: 'Welcome message shown', verificationType: 'ui' },
        ],
      });

      const result = await executor.execute(tc, makeContext());
      expect(result.status).toBe('passed');
      expect(result.steps).toHaveLength(3);
      expect(result.assertions).toHaveLength(1);
      expect(result.assertions[0].status).toBe('passed');
    });

    it('returns error when browser fails to start', async () => {
      const ai = createFakeAI(() => ({}));
      const session = {
        start: async () => { throw new Error('Browser crashed'); },
        page: () => { throw new Error('No page'); },
        screenshot: async () => Buffer.from(''),
        close: async () => {},
        isClosed: () => true,
      };

      const executor = new AgenticTestExecutor({
        browserSession: session as unknown as BrowserSession,
        aiProvider: ai,
        baseUrl: 'http://127.0.0.1:3000',
        capabilities: { ...defaultCapabilities(), browser: 'AVAILABLE' },
      });

      const result = await executor.execute(makeTestCase(), makeContext());
      expect(result.status).toBe('error');
      expect(result.error?.code).toBe('AGENT_BROWSER_ERROR');
    });

    it('returns blocked when grounding fails repeatedly', async () => {
      const ai = createFakeAI(() => ({
        action: undefined,
        confidence: 'low',
        reasoning: 'Cannot find element',
        unresolvedReason: 'AGENT_GROUNDING_FAILED',
      }));

      const observations = [loginPageObservation(), loginPageObservation(), loginPageObservation(), loginPageObservation()];
      const { executor } = buildExecutor({ ai, observationSequence: observations });

      const tc = makeTestCase({
        steps: [{ order: 1, action: 'Click nonexistent element' }],
        expectedResults: [],
      });

      const result = await executor.execute(tc, makeContext());
      expect(result.status).toBe('blocked');
    });

    it('returns failed when assertion contradicts', async () => {
      let callCount = 0;
      const ai = createFakeAI((_req) => {
        callCount++;
        if (callCount === 1) {
          return { action: { type: 'click', elementId: 'el-003' }, confidence: 'high', reasoning: 'test' };
        }
        return {
          assertionType: 'text-visible',
          expectedValue: 'This text does not exist',
          confidence: 'high',
          reasoning: 'test',
        };
      });

      const observations = [loginPageObservation(), loginPageObservation()];
      const { executor } = buildExecutor({ ai, observationSequence: observations });

      const tc = makeTestCase({
        steps: [{ order: 1, action: 'Click login' }],
        expectedResults: [{ description: 'Nonexistent text shown', verificationType: 'ui' }],
      });

      const result = await executor.execute(tc, makeContext());
      expect(result.status).toBe('failed');
    });

    it('handles negative login (error message displayed)', async () => {
      let callCount = 0;
      const ai = createFakeAI((_req) => {
        callCount++;
        if (callCount <= 3) {
          const actions: AgenticAction[] = [
            { type: 'fill', elementId: 'el-001', value: 'demo' },
            { type: 'fill', elementId: 'el-002', value: 'wrong-password' },
            { type: 'click', elementId: 'el-003' },
          ];
          return { action: actions[callCount - 1], confidence: 'high', reasoning: 'test' };
        }
        return {
          assertionType: 'text-visible',
          expectedValue: 'Invalid credentials',
          confidence: 'high',
          reasoning: 'test',
        };
      });

      const observations = [
        loginPageObservation(),
        loginPageObservation(),
        loginPageObservation(),
        errorLoginObservation(),
      ];
      const { executor } = buildExecutor({ ai, observationSequence: observations });

      const tc = makeTestCase({
        steps: [
          { order: 1, action: 'Enter username', input: 'demo' },
          { order: 2, action: 'Enter wrong password' },
          { order: 3, action: 'Click login' },
        ],
        expectedResults: [
          { description: 'Error message is displayed', verificationType: 'ui' },
        ],
      });

      const result = await executor.execute(tc, makeContext());
      expect(result.status).toBe('passed');
      expect(result.assertions[0].status).toBe('passed');
    });

    it('cleanup succeeds', async () => {
      const { executor } = buildExecutor({ ai: createFakeAI(() => ({})) });
      const result = await executor.cleanup(makeTestCase(), makeContext());
      expect(result.status).toBe('succeeded');
    });
  });
});
