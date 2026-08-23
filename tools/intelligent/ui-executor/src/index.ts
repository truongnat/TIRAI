// UI Executor v1 — Barrel export.

// Core executor
export { UIExecutor } from './ui-executor.js';

// Catalog + locator
export { LocatorResolver } from './catalog/index.js';

// Action planner
export { ActionPlanner } from './planner/index.js';

// Assertion verifier
export { AssertionVerifier } from './assertion/index.js';

// Mapping validator
export { MappingValidator } from './mapping/index.js';
export type { MappingValidationResult } from './mapping/index.js';

// Browser
export { FakeBrowserSession, FakeBrowserPage } from './browser/index.js';
export type { FakeBrowserConfig, FakeElementState } from './browser/index.js';

// Browser policy
export {
  DEFAULT_BROWSER_POLICY,
  mergeBrowserPolicy,
  validateOrigin,
  resolveUrl,
  validateBaseUrl,
  validateKeyPress,
} from './browser-policy.js';

// Errors + warnings
export { UIExecutorError, UI_ERROR_CODES } from './errors.js';
export { UIWarningCode } from './warnings.js';

// Types — re-export all models
export type {
  UIActionType,
  UILocatorStrategy,
  UIElementTarget,
  UIElementCatalog,
  UIPageDefinition,
  UIElementDefinition,
  UIElementLocator,
  UIValueExpression,
  UIActionPlan,
  UIAssertionType,
  UIAssertionPlan,
  UIAssertionResult,
  TestExecutionMapping,
  UIStepMapping,
  UIAssertionMapping,
  UIBrowserPolicy,
  UIEnvironmentConfig,
  BrowserSession,
  BrowserPage,
  ResolvedLocator,
  UIErrorCode,
  UIExecutorOptions,
  UIActionResult,
} from './models.js';

// Re-export upstream orchestrator types consumed by downstream
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
} from './models.js';
