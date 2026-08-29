// Test Code Generator — Phase 5.1 canonical models.
//
// Minimal, framework-neutral generation boundary. Only Playwright is
// implemented in Phase 5.1. The generator consumes canonical TestCase,
// ExecutionMappingIR and ProjectExecutionProfile models and materializes them
// into real, independently executable Playwright test source.
//
// Design invariants (spec §3, §15, §36):
//   * AI calls during generation = 0.
//   * No guessing of selectors / routes / URLs / credentials.
//   * No source-specific (Excel / Markdown / PDF) branching in the generator.
//   * Generated source is deterministic for semantically-equal inputs.

import type {
  TestCase,
  ExecutionMappingIR,
  ProjectExecutionProfile,
  TestRunResultIR,
} from './re-export.js';

export type {
  TestCase,
  ExecutionMappingIR,
  ProjectExecutionProfile,
  TestRunResultIR,
};

/** Playwright (E2E) implemented in Phase 5.1; Vitest (unit) added in Phase 5.2. */
export type SupportedFramework = 'playwright' | 'vitest';

/** Distinct execution mode vs AGENTIC_BROWSER (spec §18). Recorded in result envelope, NOT in frozen TestRunMode. */
export type GenerationExecutionMode = 'GENERATED_E2E' | 'GENERATED_UNIT';

// ---- Generation block reasons (fail-closed taxonomy) ----------------------

export type GenerationBlockCode =
  | 'MISSING_MAPPING'
  | 'MISSING_LOCATOR'
  | 'UNSUPPORTED_ACTION'
  | 'UNMAPPABLE_ASSERTION'
  | 'MISSING_VALUE'
  // Phase 5.2 — unit / target-code mapping block reasons
  | 'NOT_FOUND'
  | 'AMBIGUOUS'
  | 'UNSUPPORTED_SYMBOL'
  | 'UNRESOLVED_INPUT'
  | 'UNSUPPORTED_ASSERTION'
  | 'STALE_MAPPING';

export interface GenerationBlockReason {
  code: GenerationBlockCode;
  message: string;
  stepOrder?: number;
  expectedResultIndex?: number;
}

export interface GenerationDiagnostic {
  severity: 'info' | 'warning' | 'blocked';
  message: string;
  stepOrder?: number;
  expectedResultIndex?: number;
}

// ---- Per-test-case generation result --------------------------------------

export type TestCaseGenerationStatus = 'generated' | 'blocked';

export interface TestCaseGenerationResult {
  testCaseId: string;
  status: TestCaseGenerationStatus;
  /** Absolute path of the generated *.spec.ts when status = 'generated'. */
  generatedFilePath?: string;
  /** Deterministic artifact identity (traceable to TestCase). */
  artifactId: string;
  /** Fingerprint over the canonical generation inputs (TestCase + mapping + profile). */
  generationFingerprint: string;
  /** Fingerprint over the generated source bytes. */
  sourceFingerprint: string;
  /** Present only when status = 'blocked'. */
  blockingReason?: GenerationBlockReason;
  diagnostics: GenerationDiagnostic[];
  /** Count of trusted (catalog / mapping) resolutions used. */
  trustedMappingsUsed: number;
  /** Must always be 0 (spec §6: no guessing). */
  guessedMappings: number;
}

// ---- Generation options / input -------------------------------------------

export interface TestCodeGenerationOptions {
  framework?: SupportedFramework;
  /** Directory where generated *.spec.ts files are written. */
  outputDir: string;
  /** Override base URL (defaults to profile.ui.environment.baseUrl). */
  baseUrl?: string;
  browser?: 'chromium' | 'firefox' | 'webkit';
  /** data-testid attribute name (defaults to Playwright default 'data-testid'). */
  testIdAttribute?: string;
  generatedBy?: string;
}

export interface TestCodeGenerationInput {
  testCases: TestCase[];
  mapping: ExecutionMappingIR;
  profile: ProjectExecutionProfile;
  options: TestCodeGenerationOptions;
}

// ---- Generation result ----------------------------------------------------

export type TestCodeGenerationStatus = 'success' | 'partial' | 'blocked';

export interface GenerationMetrics {
  testCasesReceived: number;
  testCasesGenerated: number;
  testCasesBlocked: number;
  generatedFiles: number;
  generatedBytes: number;
  generationAiCalls: number;
  trustedMappingsUsed: number;
  guessedMappings: number;
  unsupportedActions: number;
  unmappableAssertions: number;
  sourceSpecificBranchesInGenerator: number;
}

export interface TestCodeGenerationResult {
  framework: SupportedFramework;
  status: TestCodeGenerationStatus;
  generatedFiles: string[];
  caseResults: TestCaseGenerationResult[];
  metrics: GenerationMetrics;
  fingerprint: string;
}

// ---- Validation outcome --------------------------------------------------

export interface ValidationOutcome {
  filePath: string;
  status: 'valid' | 'invalid';
  parseOk: boolean;
  discoverable: boolean;
  formattedWith: 'prettier';
  errors: string[];
  /** When invalid, generation/execution must NOT proceed. */
  blockedReason?: string;
}

// ---- Execution outcome ----------------------------------------------------

export interface ExecutionMetrics {
  validationAttempts: number;
  validationPassed: number;
  validationFailed: number;
  playwrightExecutionAttempts: number;
  playwrightPassed: number;
  playwrightFailed: number;
  playwrightErrors: number;
  executionAiCalls: number;
  agenticFallbacks: number;
}

export interface GeneratedTestExecutionResult {
  executionMode: GenerationExecutionMode;
  framework: SupportedFramework;
  /** Canonical result (reused TestRunResultIR from test-execution-orchestrator). */
  result: TestRunResultIR;
  metrics: ExecutionMetrics;
  playwrightJsonPath?: string;
  logs: string[];
}

// ===========================================================================
// Phase 5.2 — Unit test generation (Vitest) + Target-Code Mapping Bridge.
//
// Design (spec §3, §4, §9, §10): canonical TestCase describes WHAT; the
// TargetCodeMapping (a trusted bridge layer, NOT the canonical TestCase) describes
// WHERE/HOW the behavior is implemented and how inputs/expected map to the
// target symbol. The generator emits a real, independently executable Vitest
// test. No AI symbol guessing, no source-connector (Excel/Markdown/PDF) branching.
// ===========================================================================

export type TargetSymbolKind = 'function' | 'class' | 'method';

/** Minimal trusted target-project profile (spec §7). No credentials. */
export interface TargetProjectProfile {
  projectRoot: string;
  language: 'typescript' | 'javascript';
  moduleSystem: 'esm' | 'cjs';
  unitTestFramework: 'vitest';
  sourceRoots: string[];
  testRoots: string[];
  testCommand: string;
  tsconfigPath?: string;
}

/** Trusted identity of a discovered target symbol (spec §9). */
export interface TargetCodeSymbol {
  sourceFile: string;
  symbolName: string;
  kind: TargetSymbolKind;
  /** POSIX relative import path (no extension) from the generated test dir. */
  importPath: string;
  params: Array<{ name: string; type?: string }>;
  isAsync: boolean;
  returnType?: string;
  /** Hash of the target source file for staleness detection (spec §34). */
  fingerprint: string;
}

export type TargetMappingStatus =
  | 'RESOLVED'
  | 'AMBIGUOUS'
  | 'NOT_FOUND'
  | 'UNSUPPORTED'
  | 'STALE_MAPPING'
  | 'UNRESOLVED_INPUT'
  | 'UNSUPPORTED_ASSERTION';

export type UnitAssertionType =
  | 'deep-equal'
  | 'primitive-equal'
  | 'boolean'
  | 'null'
  | 'non-null'
  | 'throws'
  | 'rejects';

/**
 * Trusted bridge mapping a canonical TestCase to a concrete target symbol.
 * This is NOT part of the canonical TestCase model. The binding is explicit
 * (argumentInputNames reference TestCase.inputs[].name by name), so mapping is
 * deterministic and never inferred from JSON ordering (spec §18).
 */
export interface UnitTargetCodeMapping {
  testCaseId: string;
  symbolRef: { sourceFile: string; symbolName: string; kind?: TargetSymbolKind };
  /** Ordered TestCase.inputs[].name values bound to function parameters. */
  argumentInputNames: string[];
  /** Index into testCase.expectedResults used for the assertion. */
  expectedResultIndex?: number;
  assertionType: UnitAssertionType;
  /** Recorded fingerprint of the target source at mapping time (staleness). */
  targetFingerprint?: string;
}

export interface UnitGenerationInput {
  testCases: TestCase[];
  profile: TargetProjectProfile;
  targetMappings: UnitTargetCodeMapping[];
  framework: 'vitest';
  options: TestCodeGenerationOptions;
}

export interface UnitGenerationMetrics {
  testCasesReceived: number;
  testCasesGenerated: number;
  testCasesBlocked: number;
  targetSymbolsScanned: number;
  targetSymbolsResolved: number;
  targetSymbolsAmbiguous: number;
  targetSymbolsMissing: number;
  staleMappingsDetected: number;
  inputMappingsResolved: number;
  inputMappingsBlocked: number;
  assertionMappingsResolved: number;
  assertionMappingsBlocked: number;
  generatedUnitFiles: number;
  generatedUnitBytes: number;
  generationAiCalls: number;
  aiSymbolGuesses: number;
  guessedMappings: number;
  sourceSpecificBranchesInUnitGenerator: number;
  unsupportedAssertions: number;
}

export interface UnitGenerationResult {
  framework: 'vitest';
  status: TestCodeGenerationStatus;
  generatedFiles: string[];
  caseResults: TestCaseGenerationResult[];
  metrics: UnitGenerationMetrics;
  fingerprint: string;
}

export interface UnitExecutionMetrics {
  validationAttempts: number;
  validationPassed: number;
  validationFailed: number;
  vitestExecutionAttempts: number;
  vitestPassed: number;
  vitestFailed: number;
  vitestErrors: number;
  executionAiCalls: number;
  agenticFallbacks: number;
  aiSymbolGuesses: number;
}

export interface UnitExecutionResult {
  executionMode: 'GENERATED_UNIT';
  framework: 'vitest';
  /** Canonical result (reused TestRunResultIR). */
  result: TestRunResultIR;
  metrics: UnitExecutionMetrics;
  vitestJsonPath?: string;
  logs: string[];
}
