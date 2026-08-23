// Quality metrics — aggregates run quality (spec §175-178).

import type {
  EndToEndRunQuality,
  TestRunResultIR,
} from '../models.js';

export function computeRunQuality(
  testResults: TestRunResultIR,
  durationMs: number,
  cleanupFailures: number,
): EndToEndRunQuality {
  const s = testResults.summary;
  return {
    testsTotal: s.testsTotal,
    testsPassed: s.passed,
    testsFailed: s.failed,
    testsBlocked: s.blocked,
    testsManual: s.manual,
    testsError: s.errors,
    assertionsTotal: s.assertionsTotal,
    assertionsPassed: s.assertionsPassed,
    assertionsFailed: s.assertionsFailed,
    evidenceCount: s.evidenceItems,
    cleanupFailures,
    provenanceCoverage: s.provenanceCoverage,
    durationMs,
  };
}
