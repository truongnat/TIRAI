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

/** Only Playwright is implemented in Phase 5.1 (spec §39). */
export type SupportedFramework = 'playwright';

/** Distinct execution mode vs AGENTIC_BROWSER (spec §18). Recorded in result envelope, NOT in frozen TestRunMode. */
export type GenerationExecutionMode = 'GENERATED_E2E';

// ---- Generation block reasons (fail-closed taxonomy) ----------------------

export type GenerationBlockCode =
  | 'MISSING_MAPPING'
  | 'MISSING_LOCATOR'
  | 'UNSUPPORTED_ACTION'
  | 'UNMAPPABLE_ASSERTION'
  | 'MISSING_VALUE';

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
