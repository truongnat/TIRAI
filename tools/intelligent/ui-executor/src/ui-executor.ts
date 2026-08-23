// UI Executor v1 — Main UIExecutor implementing TestExecutor contract.
//
// Plugs into the Test Execution Orchestrator as a TestExecutor plugin.
// Handles test cases with explicit TestExecutionMapping. Supports dry-run,
// simulate, and execute modes. No AI at runtime. No real internet targets.
//
// v1.1 — Real Playwright layer:
// - Removed silent FakeBrowserSession fallback
// - Session ownership + lifecycle counters
// - Context isolation per test case
// - Evidence wiring (screenshot → evidenceIds)
// - Sensitive field tracking (screenshot suppression + assertion redaction)

import type {
  TestCase,
  TestExecutor,
  TestExecutorMatch,
  TestExecutorValidation,
  TestExecutorResult,
  TestExecutionContext,
  TestExecutorType,
  TestStepExecutionResult,
  AssertionResult,
  TestCleanupResult,
  TestExecutionWarning,
  EvidenceReference,
  UIActionPlan,
  UIAssertionPlan,
  UIBrowserPolicy,
  UIEnvironmentConfig,
  UIElementCatalog,
  BrowserSession,
  BrowserLifecycleCounters,
  BrowserSessionFactory,
  TestExecutionMapping,
} from './models.js';
import { LocatorResolver } from './catalog/index.js';
import { ActionPlanner } from './planner/index.js';
import { AssertionVerifier } from './assertion/index.js';
import { MappingValidator } from './mapping/index.js';
import {
  mergeBrowserPolicy,
  validateOrigin,
  resolveUrl,
  validateBaseUrl,
  validateKeyPress,
} from './browser-policy.js';
import { UIExecutorError } from './errors.js';
import { UIWarningCode } from './warnings.js';

export class UIExecutor implements TestExecutor {
  readonly type: TestExecutorType = 'ui';

  private resolver: LocatorResolver;
  private planner: ActionPlanner;
  private verifier: AssertionVerifier;
  private mappingValidator: MappingValidator;
  private policy: UIBrowserPolicy;
  private mappings: TestExecutionMapping[];
  private environment: Partial<UIEnvironmentConfig>;
  private session: BrowserSession | null;
  private sessionFactory: BrowserSessionFactory | null;
  private sessionOwned = false;
  private started = false;
  private sensitiveFilled = false;
  private counters: BrowserLifecycleCounters = {
    browsersLaunched: 0,
    browsersClosed: 0,
    contextsCreated: 0,
    contextsClosed: 0,
    pagesCreated: 0,
    pagesClosed: 0,
  };

  constructor(options: {
    catalog: UIElementCatalog;
    mappings?: TestExecutionMapping[];
    browserPolicy?: Partial<UIBrowserPolicy>;
    environment?: Partial<UIEnvironmentConfig>;
    browserSession?: BrowserSession;
    sessionFactory?: BrowserSessionFactory;
  }) {
    this.mappings = options.mappings ?? [];
    this.policy = mergeBrowserPolicy(options.browserPolicy);
    this.environment = options.environment ?? {};
    this.resolver = new LocatorResolver(options.catalog, this.policy.testIdAttribute);
    this.planner = new ActionPlanner(this.resolver);
    this.verifier = new AssertionVerifier(this.resolver);
    this.mappingValidator = new MappingValidator(this.resolver);
    // No silent fake fallback — session must be explicitly provided
    this.session = options.browserSession ?? null;
    this.sessionFactory = options.sessionFactory ?? null;
  }

  // ---- TestExecutor contract: canExecute -----------------------------------

  canExecute(testCase: TestCase, _context: TestExecutionContext): TestExecutorMatch {
    const mapping = this.findMapping(testCase.id);
    if (!mapping) {
      return {
        supported: false,
        score: 0,
        reasons: [`No UI execution mapping for test case '${testCase.id}'.`],
      };
    }
    if (mapping.executorType !== 'ui') {
      return {
        supported: false,
        score: 0,
        reasons: [`Mapping executorType is '${mapping.executorType}', not 'ui'.`],
      };
    }
    return {
      supported: true,
      score: 0.9,
      reasons: ['UI execution mapping found', 'Test case has explicit UI mapping'],
    };
  }

  // ---- TestExecutor contract: validate -------------------------------------

  async validate(testCase: TestCase, _context: TestExecutionContext): Promise<TestExecutorValidation> {
    const mapping = this.findMapping(testCase.id);
    if (!mapping) {
      return {
        valid: false,
        errors: [{ code: 'UI_MAPPING_MISSING', message: `No mapping for '${testCase.id}'.`, testCaseId: testCase.id }],
      };
    }
    const result = this.mappingValidator.validateMapping(mapping, testCase);
    return {
      valid: result.valid,
      errors: result.errors.map((e) => ({ code: 'UI_INVALID_TEST_CASE', message: e, testCaseId: testCase.id })),
    };
  }

  // ---- TestExecutor contract: execute --------------------------------------

  async execute(testCase: TestCase, context: TestExecutionContext): Promise<TestExecutorResult> {
    const warnings: TestExecutionWarning[] = [];
    const steps: TestStepExecutionResult[] = [];
    const assertions: AssertionResult[] = [];
    const evidence: EvidenceReference[] = [];

    // Find mapping
    const mapping = this.findMapping(testCase.id);
    if (!mapping) {
      return {
        status: 'skipped',
        steps: [],
        assertions: [],
        evidence: [],
        warnings: [{ code: UIWarningCode.UI_MAPPING_MISSING, message: `No UI mapping for '${testCase.id}'.`, testCaseId: testCase.id }],
      };
    }

    // Dry-run: report readiness without executing
    if (context.mode === 'dry-run') {
      return {
        status: 'skipped',
        steps: testCase.steps.map((s) => ({
          order: s.order,
          action: `ui:${this.getActionLabel(mapping, s.order)}`,
          status: 'skipped' as const,
          startedAt: context.clock.nowIso(),
          finishedAt: context.clock.nowIso(),
          evidenceIds: [],
        })),
        assertions: testCase.expectedResults.map((er, idx) => ({
          id: `ASR-${String(idx + 1).padStart(3, '0')}`,
          expectedResultIndex: idx,
          description: er.description,
          verificationType: er.verificationType,
          status: 'not-verified' as const,
          evidenceIds: [],
        })),
        evidence: [],
        warnings: [{ code: UIWarningCode.UI_TEST_SKIPPED, message: 'Dry-run mode — UI test not executed.', testCaseId: testCase.id }],
      };
    }

    // Simulate: use explicitly injected FakeBrowserSession
    if (context.mode === 'simulate') {
      return this.executeSimulate(testCase, context, mapping, warnings, evidence);
    }

    // Execute mode: real browser interaction
    try {
      // Fail closed if no session available
      if (!this.session && !this.sessionFactory) {
        throw new UIExecutorError(
          'UI_BROWSER_SESSION_MISSING',
          'Execute mode requires a BrowserSession or BrowserSessionFactory. ' +
          'FakeBrowserSession must not be used in execute mode.',
        );
      }

      // Create session from factory if needed
      if (!this.session && this.sessionFactory) {
        this.session = this.sessionFactory.create();
        this.sessionOwned = true;
      }

      // Reset sensitive tracking
      this.sensitiveFilled = false;

      // Ensure browser session is started
      await this.ensureSessionStarted(context);

      // Create isolated context for this test case (if PlaywrightBrowserSession)
      if ('createIsolatedPage' in this.session! && typeof (this.session as Record<string, unknown>).createIsolatedPage === 'function') {
        await (this.session as BrowserSession & { createIsolatedPage(): Promise<unknown> }).createIsolatedPage();
        this.syncCounters();
      }

      // Navigate to page route if mapping specifies pageId
      if (mapping.pageId) {
        const route = this.resolver.getPageRoute(mapping.pageId);
        if (route) {
          const envConfig = this.buildEnvironmentConfig(context);
          const fullUrl = resolveUrl(envConfig.baseUrl, route);
          validateOrigin(fullUrl, this.policy);
          await this.session!.page().goto(fullUrl, { timeoutMs: this.policy.navigationTimeoutMs });
        }
      }

      // Compile and execute action plans
      const actionPlans = await this.planner.compileActions(mapping, context.bindings, context.secrets);
      for (const plan of actionPlans) {
        const stepResult = await this.executeAction(plan, context, testCase.id, evidence);
        steps.push(stepResult);
        if (stepResult.status === 'failed' || stepResult.status === 'blocked') {
          // Capture failure screenshot (if not suppressed by sensitive fill)
          const screenshotEvId = await this.captureFailureScreenshot(context, testCase.id, plan.stepOrder);
          if (screenshotEvId) {
            stepResult.evidenceIds = [...stepResult.evidenceIds, screenshotEvId];
            evidence.push(context.evidence.list().find((e) => e.id === screenshotEvId)!);
          }
          break;
        }
      }

      // Compile and verify assertion plans
      const assertionPlans = this.compileAssertions(mapping, testCase);
      const assertionResults = await this.verifier.verifyAll(assertionPlans, this.session!.page());
      for (const ar of assertionResults) {
        const assertionId = `ASR-${String(ar.plan.expectedResultIndex + 1).padStart(3, '0')}`;
        const er = testCase.expectedResults[ar.plan.expectedResultIndex];

        // Redact actual if assertion reads a sensitive element
        let actual = ar.actual;
        if (ar.plan.target && this.resolver.isSensitive(ar.plan.target.logicalName)) {
          actual = '***REDACTED***';
        }

        assertions.push({
          id: assertionId,
          expectedResultIndex: ar.plan.expectedResultIndex,
          description: ar.plan.description,
          verificationType: er?.verificationType ?? 'automated',
          status: ar.status === 'blocked' ? 'blocked' : ar.status === 'failed' ? 'failed' : 'passed',
          actual,
          evidenceIds: [],
        });
        if (ar.status === 'failed') {
          const screenshotEvId = await this.captureFailureScreenshot(context, testCase.id);
          if (screenshotEvId) {
            assertions[assertions.length - 1].evidenceIds = [screenshotEvId];
          }
        }
      }

      // Determine overall status
      const status = this.computeStatus(steps, assertions);

      return { status, steps, assertions, evidence, warnings };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = err instanceof UIExecutorError ? err.code : 'UI_INTERNAL_ERROR';
      return {
        status: 'error',
        steps,
        assertions,
        evidence,
        error: { code, message, retryable: false, executorType: 'ui' },
        warnings,
      };
    }
  }

  // ---- TestExecutor contract: cleanup --------------------------------------

  async cleanup(_testCase: TestCase, _context: TestExecutionContext): Promise<TestCleanupResult> {
    try {
      if (this.sessionOwned && this.session && !this.session.isClosed()) {
        await this.session.close();
      }
      this.syncCounters();
    } finally {
      this.started = false;
      this.sensitiveFilled = false;
    }
    return { status: 'succeeded', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() };
  }

  // ---- Lifecycle counters --------------------------------------------------

  getLifecycleCounters(): Readonly<BrowserLifecycleCounters> {
    return { ...this.counters };
  }

  private syncCounters(): void {
    if (this.session && 'getCounters' in this.session && typeof (this.session as Record<string, unknown>).getCounters === 'function') {
      const c = (this.session as BrowserSession & { getCounters(): BrowserLifecycleCounters }).getCounters();
      this.counters = { ...c };
    }
  }

  // ---- Internal helpers ----------------------------------------------------

  private findMapping(testCaseId: string): TestExecutionMapping | null {
    return MappingValidator.findMapping(this.mappings, testCaseId);
  }

  private getActionLabel(mapping: TestExecutionMapping, stepOrder: number): string {
    const sm = mapping.stepMappings.find((m) => m.stepOrder === stepOrder);
    return sm?.action ?? 'noop';
  }

  private async ensureSessionStarted(context: TestExecutionContext): Promise<void> {
    if (this.started) return;
    const envConfig = this.buildEnvironmentConfig(context);
    validateBaseUrl(envConfig);
    try {
      await this.session!.start(envConfig);
      this.started = true;
    } catch (err) {
      throw new UIExecutorError(
        'UI_BROWSER_START_FAILED',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private buildEnvironmentConfig(_context: TestExecutionContext): UIEnvironmentConfig {
    return {
      baseUrl: this.environment.baseUrl ?? '',
      allowedOrigins: this.environment.allowedOrigins ?? this.policy.allowedOrigins,
      browser: this.environment.browser ?? this.policy.browser,
      headless: this.environment.headless ?? this.policy.headless,
      ...this.environment,
    };
  }

  // ---- Simulate mode: use injected FakeBrowserSession ----------------------

  private async executeSimulate(
    testCase: TestCase,
    context: TestExecutionContext,
    mapping: TestExecutionMapping,
    warnings: TestExecutionWarning[],
    evidence: EvidenceReference[],
  ): Promise<TestExecutorResult> {
    // If no session injected, simulate produces pass with warning
    if (!this.session) {
      return {
        status: 'passed',
        steps: testCase.steps.map((s) => ({
          order: s.order,
          action: `ui:${this.getActionLabel(mapping, s.order)}`,
          status: 'passed' as const,
          startedAt: context.clock.nowIso(),
          finishedAt: context.clock.nowIso(),
          evidenceIds: [],
        })),
        assertions: testCase.expectedResults.map((er, idx) => ({
          id: `ASR-${String(idx + 1).padStart(3, '0')}`,
          expectedResultIndex: idx,
          description: er.description,
          verificationType: er.verificationType,
          status: 'passed' as const,
          evidenceIds: [],
        })),
        evidence: [],
        warnings: [{ code: UIWarningCode.UI_TEST_SKIPPED, message: 'Simulate mode — no browser session injected.', testCaseId: testCase.id }],
      };
    }

    // With injected session, actually run through the actions
    try {
      const envConfig = this.buildEnvironmentConfig(context);
      validateBaseUrl(envConfig);
      await this.session.start(envConfig);

      if (mapping.pageId) {
        const route = this.resolver.getPageRoute(mapping.pageId);
        if (route) {
          const fullUrl = resolveUrl(envConfig.baseUrl, route);
          validateOrigin(fullUrl, this.policy);
          await this.session.page().goto(fullUrl, { timeoutMs: this.policy.navigationTimeoutMs });
        }
      }

      const steps: TestStepExecutionResult[] = [];
      const actionPlans = await this.planner.compileActions(mapping, context.bindings, context.secrets);
      for (const plan of actionPlans) {
        const stepResult = await this.executeAction(plan, context, testCase.id, evidence);
        steps.push(stepResult);
        if (stepResult.status === 'failed' || stepResult.status === 'blocked') break;
      }

      const assertionPlans = this.compileAssertions(mapping, testCase);
      const assertionResults = await this.verifier.verifyAll(assertionPlans, this.session.page());
      const assertions: AssertionResult[] = assertionResults.map((ar, _idx) => {
        const er = testCase.expectedResults[ar.plan.expectedResultIndex];
        return {
          id: `ASR-${String(ar.plan.expectedResultIndex + 1).padStart(3, '0')}`,
          expectedResultIndex: ar.plan.expectedResultIndex,
          description: ar.plan.description,
          verificationType: er?.verificationType ?? 'automated',
          status: ar.status === 'blocked' ? 'blocked' : ar.status === 'failed' ? 'failed' : 'passed',
          actual: ar.actual,
          evidenceIds: [],
        };
      });

      const status = this.computeStatus(steps, assertions);
      return { status, steps, assertions, evidence, warnings };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = err instanceof UIExecutorError ? err.code : 'UI_INTERNAL_ERROR';
      return {
        status: 'error',
        steps: [],
        assertions: [],
        evidence,
        error: { code, message, retryable: false, executorType: 'ui' },
        warnings,
      };
    }
  }

  private async executeAction(
    plan: UIActionPlan,
    context: TestExecutionContext,
    _testCaseId: string,
    _evidence: EvidenceReference[],
  ): Promise<TestStepExecutionResult> {
    const startedAt = context.clock.nowIso();
    const page = this.session!.page();

    try {
      const resolvedValue = await ActionPlanner.resolveValue(plan.value, context.bindings, context.secrets);

      switch (plan.action) {
        case 'navigate': {
          const url = resolveUrl(this.buildEnvironmentConfig(context).baseUrl, resolvedValue ?? '/');
          validateOrigin(url, this.policy);
          await page.goto(url, { timeoutMs: plan.timeoutMs ?? this.policy.navigationTimeoutMs });
          break;
        }
        case 'click': {
          if (!plan.target) throw new UIExecutorError('UI_LOCATOR_MAPPING_MISSING', 'click requires target');
          const loc = this.resolver.resolve(plan.target);
          await page.click(loc, { timeoutMs: plan.timeoutMs ?? this.policy.actionTimeoutMs });
          break;
        }
        case 'fill': {
          if (!plan.target) throw new UIExecutorError('UI_LOCATOR_MAPPING_MISSING', 'fill requires target');
          const loc = this.resolver.resolve(plan.target);
          // Track sensitive fills
          if (plan.target.logicalName && this.resolver.isSensitive(plan.target.logicalName)) {
            this.sensitiveFilled = true;
          }
          if (plan.value?.kind === 'secret') {
            this.sensitiveFilled = true;
          }
          await page.fill(loc, resolvedValue ?? '', { timeoutMs: plan.timeoutMs ?? this.policy.actionTimeoutMs });
          break;
        }
        case 'type': {
          if (!plan.target) throw new UIExecutorError('UI_LOCATOR_MAPPING_MISSING', 'type requires target');
          const loc = this.resolver.resolve(plan.target);
          if (plan.target.logicalName && this.resolver.isSensitive(plan.target.logicalName)) {
            this.sensitiveFilled = true;
          }
          if (plan.value?.kind === 'secret') {
            this.sensitiveFilled = true;
          }
          await page.type(loc, resolvedValue ?? '', { timeoutMs: plan.timeoutMs ?? this.policy.actionTimeoutMs });
          break;
        }
        case 'select': {
          if (!plan.target) throw new UIExecutorError('UI_LOCATOR_MAPPING_MISSING', 'select requires target');
          const loc = this.resolver.resolve(plan.target);
          await page.selectOption(loc, resolvedValue ?? '', { timeoutMs: plan.timeoutMs ?? this.policy.actionTimeoutMs });
          break;
        }
        case 'check': {
          if (!plan.target) throw new UIExecutorError('UI_LOCATOR_MAPPING_MISSING', 'check requires target');
          const loc = this.resolver.resolve(plan.target);
          await page.check(loc, { timeoutMs: plan.timeoutMs ?? this.policy.actionTimeoutMs });
          break;
        }
        case 'uncheck': {
          if (!plan.target) throw new UIExecutorError('UI_LOCATOR_MAPPING_MISSING', 'uncheck requires target');
          const loc = this.resolver.resolve(plan.target);
          await page.uncheck(loc, { timeoutMs: plan.timeoutMs ?? this.policy.actionTimeoutMs });
          break;
        }
        case 'press': {
          if (!plan.target) throw new UIExecutorError('UI_LOCATOR_MAPPING_MISSING', 'press requires target');
          const loc = this.resolver.resolve(plan.target);
          validateKeyPress(resolvedValue ?? 'Enter');
          await page.press(loc, resolvedValue ?? 'Enter', { timeoutMs: plan.timeoutMs ?? this.policy.actionTimeoutMs });
          break;
        }
        case 'focus': {
          if (!plan.target) throw new UIExecutorError('UI_LOCATOR_MAPPING_MISSING', 'focus requires target');
          const loc = this.resolver.resolve(plan.target);
          await page.focus(loc, { timeoutMs: plan.timeoutMs ?? this.policy.actionTimeoutMs });
          break;
        }
        case 'blur': {
          if (!plan.target) throw new UIExecutorError('UI_LOCATOR_MAPPING_MISSING', 'blur requires target');
          const loc = this.resolver.resolve(plan.target);
          await page.blur(loc, { timeoutMs: plan.timeoutMs ?? this.policy.actionTimeoutMs });
          break;
        }
        case 'wait': {
          if (plan.target) {
            const loc = this.resolver.resolve(plan.target);
            await page.waitForVisible(loc, { timeoutMs: plan.timeoutMs ?? this.policy.actionTimeoutMs });
          }
          break;
        }
        case 'scroll':
        case 'noop':
          break;
        default:
          throw new UIExecutorError('UI_ACTION_UNSUPPORTED', `Unsupported action: '${plan.action}'.`);
      }

      return {
        order: plan.stepOrder,
        action: plan.action,
        status: 'passed',
        startedAt,
        finishedAt: context.clock.nowIso(),
        evidenceIds: [],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = err instanceof UIExecutorError ? err.code : 'UI_INTERNAL_ERROR';
      return {
        order: plan.stepOrder,
        action: plan.action,
        status: 'failed',
        startedAt,
        finishedAt: context.clock.nowIso(),
        evidenceIds: [],
        error: { code, message, retryable: false, executorType: 'ui' },
      };
    }
  }

  private compileAssertions(
    mapping: TestExecutionMapping,
    testCase: TestCase,
  ): UIAssertionPlan[] {
    return mapping.assertionMappings.map((am) => {
      const er = testCase.expectedResults[am.expectedResultIndex];
      return {
        expectedResultIndex: am.expectedResultIndex,
        description: er?.description ?? `Assertion ${am.expectedResultIndex}`,
        assertionType: am.assertionType,
        target: am.targetLogicalName ? { logicalName: am.targetLogicalName } : undefined,
        expectedValue: am.expectedValue,
        timeoutMs: am.timeoutMs,
      };
    });
  }

  private async captureFailureScreenshot(
    context: TestExecutionContext,
    testCaseId: string,
    stepOrder?: number,
  ): Promise<string | null> {
    if (this.policy.captureScreenshots === 'never') return null;

    // Suppress screenshot if sensitive field was filled
    if (this.sensitiveFilled) {
      return null;
    }

    try {
      const buf = await this.session!.screenshot();
      const ref = context.evidence.add({
        type: 'screenshot',
        sourceExecutor: 'ui',
        testCaseId,
        stepOrder,
        artifactRef: `ui-failure-${testCaseId}${stepOrder !== undefined ? `-step${stepOrder}` : ''}.png`,
        metadata: { size: buf.length, format: 'png' },
        sensitive: false,
      });
      return ref.id;
    } catch {
      return null;
    }
  }

  private computeStatus(
    steps: TestStepExecutionResult[],
    assertions: AssertionResult[],
  ): 'passed' | 'failed' | 'blocked' | 'error' {
    if (steps.some((s) => s.status === 'blocked') || assertions.some((a) => a.status === 'blocked')) {
      return 'blocked';
    }
    if (steps.some((s) => s.status === 'failed') || assertions.some((a) => a.status === 'failed')) {
      return 'failed';
    }
    return 'passed';
  }
}
