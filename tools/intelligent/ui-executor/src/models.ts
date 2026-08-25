// UI Executor v1 — Canonical data model.
//
// Converts logical UI Test Steps and Expected Results into safe, deterministic
// browser actions and verifications via Playwright. Implements TestExecutor
// contract from Test Execution Orchestrator.

import type {
  TestCase,
  TestStep,
  ExpectedResult,
  TestProvenance,
  TestExecutor,
  TestExecutorMatch,
  TestExecutorResult,
  TestExecutorValidation,
  TestExecutionContext,
  TestExecutorType,
  TestStepExecutionResult,
  AssertionResult,
  EvidenceReference,
  EvidenceInput,
  EvidenceCollector,
  TestExecutionError,
  TestExecutionWarning,
  TestCleanupResult,
  TestResultStatus,
  RuntimeBindingStore,
  SecretProvider,
  Clock,
} from 'test-execution-orchestrator';

// Re-export upstream types
export type {
  TestCase,
  TestStep,
  ExpectedResult,
  TestProvenance,
  TestExecutor,
  TestExecutorMatch,
  TestExecutorResult,
  TestExecutorValidation,
  TestExecutionContext,
  TestExecutorType,
  TestStepExecutionResult,
  AssertionResult,
  EvidenceReference,
  EvidenceInput,
  EvidenceCollector,
  TestExecutionError,
  TestExecutionWarning,
  TestCleanupResult,
  TestResultStatus,
  RuntimeBindingStore,
  SecretProvider,
  Clock,
};

// ---- UI Action Types (spec §9) --------------------------------------------

export type UIActionType =
  | 'navigate'
  | 'click'
  | 'fill'
  | 'type'
  | 'select'
  | 'check'
  | 'uncheck'
  | 'press'
  | 'wait'
  | 'focus'
  | 'blur'
  | 'scroll'
  | 'noop';

// ---- Locator Strategy (spec §12) ------------------------------------------

export type UILocatorStrategy =
  | 'test-id'
  | 'role'
  | 'label'
  | 'placeholder'
  | 'text'
  | 'css'
  | 'xpath';

// ---- UI Element Target (spec §14) -----------------------------------------

export interface UIElementTarget {
  logicalName: string;
  strategy?: UILocatorStrategy;
  value?: string;
  role?: string;
  exact?: boolean;
}

// ---- UI Element Catalog (spec §15) ----------------------------------------

export interface UIElementCatalog {
  environmentId: string;
  pages: UIPageDefinition[];
}

export interface UIPageDefinition {
  id: string;
  route?: string;
  elements: UIElementDefinition[];
}

export interface UIElementDefinition {
  logicalName: string;
  locator: UIElementLocator;
  sensitive?: boolean;
}

export interface UIElementLocator {
  strategy: UILocatorStrategy;
  value: string;
  role?: string;
  exact?: boolean;
}

// ---- UI Value Expression (spec §10) ---------------------------------------

export type UIValueExpression =
  | { kind: 'literal'; value: string }
  | { kind: 'binding'; bindingName: string }
  | { kind: 'secret'; secretRef: string };

// ---- UI Action Plan (spec §10) --------------------------------------------

export interface UIActionPlan {
  stepOrder: number;
  action: UIActionType;
  target?: UIElementTarget;
  value?: UIValueExpression;
  timeoutMs?: number;
  expectedIntermediateResult?: string;
}

// ---- UI Assertion Types (spec §39) ----------------------------------------

export type UIAssertionType =
  | 'visible'
  | 'hidden'
  | 'enabled'
  | 'disabled'
  | 'checked'
  | 'unchecked'
  | 'text-equals'
  | 'text-contains'
  | 'value-equals'
  | 'url-equals'
  | 'url-contains'
  | 'element-count'
  | 'attribute-equals'
  | 'page-title'
  | 'exists'
  | 'not-exists';

// ---- UI Assertion Plan (spec §40) -----------------------------------------

export interface UIAssertionPlan {
  expectedResultIndex: number;
  description: string;
  assertionType: UIAssertionType;
  target?: UIElementTarget;
  expectedValue?: string;
  timeoutMs?: number;
}

// ---- UI Assertion Result --------------------------------------------------

export interface UIAssertionResult {
  plan: UIAssertionPlan;
  status: 'passed' | 'failed' | 'blocked' | 'not-verified';
  actual?: string;
  error?: string;
}

// ---- Test Execution Mapping (spec §66) ------------------------------------

export interface TestExecutionMapping {
  testCaseId: string;
  executorType: 'ui';
  pageId?: string;
  stepMappings: UIStepMapping[];
  assertionMappings: UIAssertionMapping[];
}

// ---- UI Step Mapping (spec §67) -------------------------------------------

export interface UIStepMapping {
  stepOrder: number;
  action: UIActionType;
  targetLogicalName?: string;
  valueBinding?: string;
  valueLiteral?: string;
  secretRef?: string;
  timeoutMs?: number;
}

// ---- UI Assertion Mapping (spec §69) --------------------------------------

export interface UIAssertionMapping {
  expectedResultIndex: number;
  assertionType: UIAssertionType;
  targetLogicalName?: string;
  expectedValue?: string;
  timeoutMs?: number;
}

// ---- Browser Policy (spec §79) --------------------------------------------

export interface UIBrowserPolicy {
  allowedOrigins: string[];
  browser: 'chromium' | 'firefox' | 'webkit';
  headless: boolean;
  allowDownloads: boolean;
  allowPopups: boolean;
  captureScreenshots: 'never' | 'failure' | 'always';
  maxPages: number;
  navigationTimeoutMs: number;
  actionTimeoutMs: number;
  assertionTimeoutMs: number;
  testIdAttribute: string;
}

// ---- UI Environment Config (spec §20) -------------------------------------

export interface UIEnvironmentConfig {
  baseUrl: string;
  allowedOrigins: string[];
  browser?: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
  viewport?: { width: number; height: number };
  locale?: string;
  timezone?: string;
  ignoreHTTPSErrors?: boolean;
}

// ---- Browser Session Abstraction (spec §25) -------------------------------

export interface BrowserSession {
  start(config: UIEnvironmentConfig): Promise<void>;
  page(): BrowserPage;
  /** Optional multi-page capabilities used by the journey layer. */
  pageContexts?(): Promise<BrowserPageContext[]>;
  activatePage?(pageId: string): Promise<BrowserPageContext>;
  closePage?(pageId: string): Promise<void>;
  screenshot(): Promise<Buffer>;
  close(): Promise<void>;
  isClosed(): boolean;
}

export interface BrowserPage {
  goto(url: string, options?: { timeoutMs?: number }): Promise<void>;
  click(target: ResolvedLocator, options?: { timeoutMs?: number }): Promise<void>;
  fill(target: ResolvedLocator, value: string, options?: { timeoutMs?: number }): Promise<void>;
  type(target: ResolvedLocator, value: string, options?: { timeoutMs?: number }): Promise<void>;
  selectOption(target: ResolvedLocator, value: string, options?: { timeoutMs?: number }): Promise<void>;
  check(target: ResolvedLocator, options?: { timeoutMs?: number }): Promise<void>;
  uncheck(target: ResolvedLocator, options?: { timeoutMs?: number }): Promise<void>;
  press(target: ResolvedLocator, key: string, options?: { timeoutMs?: number }): Promise<void>;
  focus(target: ResolvedLocator, options?: { timeoutMs?: number }): Promise<void>;
  blur(target: ResolvedLocator, options?: { timeoutMs?: number }): Promise<void>;
  waitForVisible(target: ResolvedLocator, options?: { timeoutMs?: number }): Promise<void>;
  waitForHidden(target: ResolvedLocator, options?: { timeoutMs?: number }): Promise<void>;
  isVisible(target: ResolvedLocator): Promise<boolean>;
  isEnabled(target: ResolvedLocator): Promise<boolean>;
  isChecked(target: ResolvedLocator): Promise<boolean>;
  textContent(target: ResolvedLocator): Promise<string>;
  inputValue(target: ResolvedLocator): Promise<string>;
  attribute(target: ResolvedLocator, name: string): Promise<string | null>;
  count(target: ResolvedLocator): Promise<number>;
  title(): Promise<string>;
  url(): string;
  goBack?(): Promise<HistoryNavigationResult>;
  evaluate<T>(expression: string): Promise<T>;
}

export interface BrowserPageContext {
  id: string;
  page: BrowserPage;
  url: string;
  openerPageId?: string;
  active: boolean;
}

export interface HistoryNavigationResult {
  success: boolean;
  url?: string;
  error?: string;
}

// ---- Resolved Locator (spec §12) ------------------------------------------

export interface ResolvedLocator {
  strategy: UILocatorStrategy;
  value: string;
  role?: string;
  name?: string;
  exact?: boolean;
  description: string;
}

// ---- UI Executor Error Codes (spec §60) -----------------------------------

export type UIErrorCode =
  | 'UI_INVALID_TEST_CASE'
  | 'UI_BASE_URL_MISSING'
  | 'UI_ORIGIN_DENIED'
  | 'UI_LOCATOR_MAPPING_MISSING'
  | 'UI_ELEMENT_NOT_FOUND'
  | 'UI_LOCATOR_AMBIGUOUS'
  | 'UI_ELEMENT_NOT_VISIBLE'
  | 'UI_ELEMENT_DISABLED'
  | 'UI_ACTION_UNSUPPORTED'
  | 'UI_BINDING_MISSING'
  | 'UI_SECRET_RESOLUTION_FAILED'
  | 'UI_NAVIGATION_FAILED'
  | 'UI_NAVIGATION_TIMEOUT'
  | 'UI_ACTION_TIMEOUT'
  | 'UI_ASSERTION_FAILED'
  | 'UI_ASSERTION_UNVERIFIABLE'
  | 'UI_SCREENSHOT_FAILED'
  | 'UI_BROWSER_START_FAILED'
  | 'UI_BROWSER_CLOSED'
  | 'UI_UNEXPECTED_POPUP'
  | 'UI_INTERNAL_ERROR'
  | 'UI_BROWSER_SESSION_MISSING';

// ---- UI Executor Options --------------------------------------------------

export interface UIExecutorOptions {
  catalog: UIElementCatalog;
  mappings?: TestExecutionMapping[];
  browserPolicy?: Partial<UIBrowserPolicy>;
  environment?: Partial<UIEnvironmentConfig>;
  browserSession?: BrowserSession;
  sessionFactory?: BrowserSessionFactory;
  evidenceRoot?: string;
}

// ---- Browser Session Factory ----------------------------------------------

export interface BrowserSessionFactory {
  create(): BrowserSession;
}

// ---- Browser Lifecycle Counters -------------------------------------------

export interface BrowserLifecycleCounters {
  browsersLaunched: number;
  browsersClosed: number;
  contextsCreated: number;
  contextsClosed: number;
  pagesCreated: number;
  pagesClosed: number;
}

// ---- UI Executor Action Result --------------------------------------------

export interface UIActionResult {
  stepOrder: number;
  action: UIActionType;
  status: 'passed' | 'failed' | 'blocked' | 'skipped';
  startedAt: string;
  finishedAt: string;
  evidenceIds: string[];
  error?: TestExecutionError;
}
