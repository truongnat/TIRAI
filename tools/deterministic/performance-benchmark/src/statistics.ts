import type { BenchmarkSample, BenchmarkStatistics, MetricName, NumericStatistics } from './models.js';

const METRICS: MetricName[] = ['wallTimeMs','cpuUserMs','cpuSystemMs','cpuTotalMs','peakRssBytes','peakHeapUsedBytes','inputBytes','outputBytes','stdoutBytes','stderrBytes'];
function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a,b) => a-b);
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * p; const low = Math.floor(index); const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}
export function calculateStatistics(samples: BenchmarkSample[]): BenchmarkStatistics {
  const result: BenchmarkStatistics = {};
  for (const metric of METRICS) {
    const values = samples.map(s => s[metric]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (!values.length) continue;
    const mean = values.reduce((a,b) => a+b, 0) / values.length;
    const variance = values.reduce((a,b) => a + (b-mean) ** 2, 0) / values.length;
    const stats: NumericStatistics = { count: values.length, min: Math.min(...values), max: Math.max(...values), mean, median: percentile(values,.5), p50: percentile(values,.5), p90: percentile(values,.9), p95: percentile(values,.95), standardDeviation: Math.sqrt(variance) };
    if (mean !== 0) stats.coefficientOfVariation = stats.standardDeviation / Math.abs(mean);
    result[metric] = stats;
  }
  return result;
}
export function metricValue(statistics: BenchmarkStatistics, metric: MetricName, field: 'median'|'max'|'mean' = 'median'): number | undefined { return statistics[metric]?.[field]; }
