// ---------------------------------------------------------------------------
// TIRAI — Output Artifact and Exporter Contracts
// ---------------------------------------------------------------------------
// Per TIRAI v1 spec §8: explicit output connector boundary.

import type { TestPlanIR, TestCase } from 'test-planner';

export interface OutputArtifactIR {
  artifactId: string;
  format: string;
  kind: 'test-case-export' | 'test-plan-export' | 'requirement-export' | 'scenario-export';
  path: string;
  testPlanFingerprint: string;
  testCaseIds: string[];
  createdAt: string;
  generatorVersion: string;
  status: 'created' | 'partial' | 'failed';
}

export interface TestOutputExporter<TOptions = unknown> {
  readonly format: string;
  export(input: {
    testPlan: TestPlanIR;
    testCases: TestCase[];
    options?: TOptions;
  }): Promise<OutputArtifactIR>;
}

export interface ExportOptions {
  outDir?: string;
  environment?: string;
  language?: string;
  includeBlocked?: boolean;
  contractFingerprint?: string;
  contractVersion?: number;
}

export interface ExportResult {
  artifacts: OutputArtifactIR[];
  errors: string[];
}
