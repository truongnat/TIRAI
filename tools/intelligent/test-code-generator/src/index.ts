// Test Code Generator — Phase 5.1 public API.
//
// Minimal, framework-neutral boundary; only Playwright implemented.
// Public contract (spec §5): generateE2ETests(input) -> TestCodeGenerationResult.

export { generateE2ETests, generationFingerprintFor } from './generator.js';
export { validateGeneratedSource, type ValidationOptions } from './validation.js';
export { executeGeneratedTests, type ExecuteOptions } from './executor-bridge.js';
export {
  mapPlaywrightJsonToRunResult,
  classifyFailure,
  type PlaywrightJsonReport,
  type PlaywrightSuite,
  type PlaywrightSpec,
  type PlaywrightTest,
  type MapContext,
  type MappedRun,
} from './result-mapper.js';
export { locatorExpression, type LocatorSpec } from './locator.js';
export {
  writeRunResultJson,
  writeSummary,
  countSecretLeaks,
  type SummaryContext,
} from './persistence.js';
export { sha256, stableStringify, artifactIdFrom } from './fingerprint.js';

export type {
  TestCase,
  ExecutionMappingIR,
  ProjectExecutionProfile,
  UIElementCatalog,
  UIElementDefinition,
  UIPageDefinition,
  UIActionType,
  UIAssertionType,
  UILocatorStrategy,
  TestExecutionMapping,
  UIStepMapping,
  UIAssertionMapping,
  TestRunResultIR,
  TestExecutionResultIR,
} from './re-export.js';

export type {
  TestCodeGenerationInput,
  TestCodeGenerationOptions,
  TestCodeGenerationResult,
  TestCaseGenerationResult,
  TestCaseGenerationStatus,
  TestCodeGenerationStatus,
  GenerationMetrics,
  GenerationBlockCode,
  GenerationBlockReason,
  GenerationDiagnostic,
  GenerationExecutionMode,
  SupportedFramework,
  ValidationOutcome,
  ExecutionMetrics,
  GeneratedTestExecutionResult,
} from './models.js';
