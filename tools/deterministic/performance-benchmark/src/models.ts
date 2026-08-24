export type MetricName =
  | 'wallTimeMs' | 'cpuUserMs' | 'cpuSystemMs' | 'cpuTotalMs'
  | 'peakRssBytes' | 'peakHeapUsedBytes' | 'inputBytes' | 'outputBytes'
  | 'stdoutBytes' | 'stderrBytes';

export interface BenchmarkInput { path: string; label?: string; }
export type DomainMetricsParser = (context: {
  stdout: string; stderr: string; exitCode?: number; success: boolean;
}) => Record<string, number>;
export interface BenchmarkTarget {
  id: string; command: string; args: string[]; cwd?: string;
  env?: Record<string, string>; timeoutMs: number;
  outputPaths?: string[]; parser?: DomainMetricsParser;
}
export interface BenchmarkCase {
  id: string; description?: string; target: BenchmarkTarget;
  inputArtifacts: BenchmarkInput[]; tags: string[];
}
export interface BenchmarkRunConfig {
  warmupRuns: number; measurementRuns: number; memorySampleIntervalMs: number;
  timeoutMs?: number; maxPeakRssMB?: number; maxWallTimeMs?: number;
  note?: string;
}
export interface BenchmarkSample {
  runIndex: number; startedAt: string; finishedAt: string; wallTimeMs: number;
  cpuUserMs?: number; cpuSystemMs?: number; cpuTotalMs?: number;
  peakRssBytes?: number; peakHeapUsedBytes?: number; inputBytes?: number;
  outputBytes?: number; stdoutBytes: number; stderrBytes: number; outputHash?: string;
  exitCode?: number; signal?: string; success: boolean; timeout: boolean;
  domainMetrics?: Record<string, number>; warnings: string[];
}
export interface NumericStatistics {
  count: number; min: number; max: number; mean: number; median: number;
  p50: number; p90: number; p95: number; standardDeviation: number;
  coefficientOfVariation?: number;
}
export type BenchmarkStatistics = Partial<Record<MetricName, NumericStatistics>>;
export interface BenchmarkInputFingerprint extends BenchmarkInput {
  sizeBytes: number; sha256: string;
}
export interface BenchmarkCaseResult {
  caseId: string; inputFingerprint: BenchmarkInputFingerprint[];
  warmupSamples: BenchmarkSample[]; samples: BenchmarkSample[];
  statistics: BenchmarkStatistics; status: 'passed' | 'failed' | 'partial';
  warnings: string[];
}
export interface BenchmarkEnvironment {
  hostname?: string; platform: string; architecture: string; osRelease: string;
  nodeVersion: string; cpuModel?: string; cpuCount: number; totalMemoryBytes: number;
}
export interface BenchmarkGitMetadata { commit?: string; branch?: string; dirty?: boolean; }
export interface BenchmarkResultIR {
  schemaVersion: '1.0'; benchmarkId: string; createdAt: string;
  environment: BenchmarkEnvironment; git: BenchmarkGitMetadata;
  config: BenchmarkRunConfig; cases: BenchmarkCaseResult[];
  summary: { casesPassed: number; casesFailed: number; casesPartial: number; warnings: string[] };
}
export type MetricDirection = 'lower-is-better' | 'higher-is-better';
export interface RegressionThresholds {
  wallTimeMedianRegressionPct?: number; peakRssMedianRegressionPct?: number;
  peakRssWorstRegressionPct?: number; outputBytesMedianRegressionPct?: number;
}
export interface MetricComparison {
  metric: string; direction: MetricDirection; baseline?: number; candidate?: number;
  absoluteDelta?: number; percentageDelta?: number;
  classification: 'improved' | 'unchanged' | 'regressed' | 'inconclusive';
}
export interface CaseComparison {
  caseId: string; metrics: MetricComparison[]; classification: MetricComparison['classification'];
  warnings: string[];
}
export interface BenchmarkComparisonIR {
  schemaVersion: '1.0'; createdAt: string; baselineBenchmarkId: string;
  candidateBenchmarkId: string; environmentCompatible: boolean;
  classification: 'improved' | 'unchanged' | 'regressed' | 'inconclusive';
  cases: CaseComparison[]; warnings: string[];
}
