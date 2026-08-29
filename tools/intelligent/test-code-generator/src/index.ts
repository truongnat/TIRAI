// Test Code Generator — Phase 5.1 public API.
//
// Minimal, framework-neutral boundary; only Playwright implemented.
// Public contract (spec §5): generateE2ETests(input) -> TestCodeGenerationResult.

export { generateE2ETests, generationFingerprintFor } from './generator.js';
export {
  generateUnitTests,
} from './unit-generator.js';
export { validateGeneratedSource, validateGeneratedUnitSource, type ValidationOptions, type UnitValidationOptions } from './validation.js';
export { executeGeneratedTests, type ExecuteOptions } from './executor-bridge.js';
export {
  executeUnitTests,
  type UnitExecuteOptions,
} from './vitest-executor.js';
export { inspectTargetProject, resolveUnitMapping, type SymbolIndex } from './target-inspector.js';
export {
  mapPlaywrightJsonToRunResult,
  classifyFailure,
  isInfrastructureError,
  type PlaywrightJsonReport,
  type PlaywrightSuite,
  type PlaywrightSpec,
  type PlaywrightTest,
  type MapContext,
  type MappedRun,
  mapVitestJsonToRunResult,
  type VitestJsonReport,
  type VitestFileResult,
  type VitestAssertionResult,
  type VitestMapContext,
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
  // Phase 5.2 — unit (Vitest) types
  TargetProjectProfile,
  TargetCodeSymbol,
  TargetSymbolKind,
  TargetMappingStatus,
  UnitAssertionType,
  UnitTargetCodeMapping,
  UnitGenerationInput,
  UnitGenerationMetrics,
  UnitGenerationResult,
  UnitExecutionMetrics,
  UnitExecutionResult,
} from './models.js';
