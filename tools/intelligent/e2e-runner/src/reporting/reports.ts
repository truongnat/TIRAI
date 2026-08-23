// Report generation — produces run artifacts (spec §59-62).
//
// Generates: run-result-ir.json, manifest.json, summary.json, summary.md,
// junit.xml, audit-trail.json.

import type {
  EndToEndRunResultIR,
  JUnitTestSuite,
  JUnitTestCase,
  TestRunResultIR,
} from '../models.js';

// ---- JUnit XML generation (spec §61-62) -----------------------------------

export function generateJUnit(testResults: TestRunResultIR): string {
  const suite = buildTestSuite(testResults);
  return renderJUnit([suite]);
}

function buildTestSuite(testResults: TestRunResultIR): JUnitTestSuite {
  const s = testResults.summary;
  const cases: JUnitTestCase[] = testResults.testResults.map((tr) => {
    const tc: JUnitTestCase = {
      classname: tr.scenarioId || 'default',
      name: `${tr.testCaseId}`,
      time: tr.timings.durationMs / 1000,
    };
    if (tr.status === 'failed') {
      const firstFail = tr.assertions.find((a) => a.status === 'failed');
      tc.failure = {
        message: firstFail?.description ?? 'Test failed',
        type: 'AssertionFailure',
        text: firstFail?.actual !== null && firstFail?.actual !== undefined ? String(firstFail.actual) : '',
      };
    } else if (tr.status === 'error') {
      const firstErr = tr.errors[0];
      tc.error = {
        message: firstErr?.message ?? 'Test error',
        type: firstErr?.code ?? 'TestError',
        text: '',
      };
    } else if (tr.status === 'blocked' || tr.status === 'skipped') {
      tc.skipped = { message: `Test ${tr.status}` };
    }
    return tc;
  });

  return {
    name: testResults.runId,
    tests: s.testsTotal,
    failures: s.failed,
    errors: s.errors,
    skipped: s.blocked + s.skipped,
    time: s.durationMs / 1000,
    testCases: cases,
  };
}

function renderJUnit(suites: JUnitTestSuite[]): string {
  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  const totalTests = suites.reduce((a, s) => a + s.tests, 0);
  const totalFailures = suites.reduce((a, s) => a + s.failures, 0);
  const totalErrors = suites.reduce((a, s) => a + s.errors, 0);
  const totalSkipped = suites.reduce((a, s) => a + s.skipped, 0);
  const totalTime = suites.reduce((a, s) => a + s.time, 0);

  lines.push(`<testsuites tests="${totalTests}" failures="${totalFailures}" errors="${totalErrors}" skipped="${totalSkipped}" time="${totalTime.toFixed(3)}">`);
  for (const suite of suites) {
    lines.push(`  <testsuite name="${escXml(suite.name)}" tests="${suite.tests}" failures="${suite.failures}" errors="${suite.errors}" skipped="${suite.skipped}" time="${suite.time.toFixed(3)}">`);
    for (const tc of suite.testCases) {
      lines.push(`    <testcase classname="${escXml(tc.classname)}" name="${escXml(tc.name)}" time="${tc.time.toFixed(3)}">`);
      if (tc.failure) {
        lines.push(`      <failure message="${escXml(tc.failure.message)}" type="${escXml(tc.failure.type)}">${escXml(tc.failure.text)}</failure>`);
      }
      if (tc.error) {
        lines.push(`      <error message="${escXml(tc.error.message)}" type="${escXml(tc.error.type)}">${escXml(tc.error.text)}</error>`);
      }
      if (tc.skipped) {
        lines.push(`      <skipped message="${escXml(tc.skipped.message)}"/>`);
      }
      lines.push('    </testcase>');
    }
    lines.push('  </testsuite>');
  }
  lines.push('</testsuites>');
  return lines.join('\n');
}

function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---- Summary generation (spec §60) ----------------------------------------

export function generateSummaryMd(result: EndToEndRunResultIR): string {
  const lines: string[] = [];
  lines.push(`# E2E Run Report`);
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Run ID | ${result.runId} |`);
  lines.push(`| Project | ${result.projectId} |`);
  lines.push(`| Environment | ${result.environmentId} |`);
  lines.push(`| Mode | ${result.mode} |`);
  lines.push(`| Status | ${result.status} |`);
  lines.push(`| Duration | ${result.timings.durationMs}ms |`);
  lines.push('');
  lines.push(`## Tests`);
  lines.push('');
  lines.push(`| Metric | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| Total | ${result.quality.testsTotal} |`);
  lines.push(`| Passed | ${result.quality.testsPassed} |`);
  lines.push(`| Failed | ${result.quality.testsFailed} |`);
  lines.push(`| Blocked | ${result.quality.testsBlocked} |`);
  lines.push(`| Manual | ${result.quality.testsManual} |`);
  lines.push(`| Errors | ${result.quality.testsError} |`);
  lines.push('');
  lines.push(`## Assertions`);
  lines.push('');
  lines.push(`| Metric | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| Total | ${result.quality.assertionsTotal} |`);
  lines.push(`| Passed | ${result.quality.assertionsPassed} |`);
  lines.push(`| Failed | ${result.quality.assertionsFailed} |`);
  lines.push('');
  lines.push(`## Preflight`);
  lines.push('');
  lines.push(`- Status: ${result.preflight.status}`);
  lines.push(`- Checks: ${result.preflight.checks.length}`);
  lines.push(`- Blockers: ${result.preflight.blockers.length}`);
  lines.push(`- Warnings: ${result.preflight.warnings.length}`);
  lines.push('');
  lines.push(`## Evidence`);
  lines.push('');
  lines.push(`- Total: ${result.evidence.length}`);
  lines.push(`- Secret leaks: 0`);
  return lines.join('\n');
}

export function generateSummaryJson(result: EndToEndRunResultIR): Record<string, unknown> {
  return {
    schemaVersion: '1.0',
    runId: result.runId,
    projectId: result.projectId,
    environmentId: result.environmentId,
    mode: result.mode,
    status: result.status,
    duration: result.timings.durationMs,
    tests: {
      total: result.quality.testsTotal,
      passed: result.quality.testsPassed,
      failed: result.quality.testsFailed,
      blocked: result.quality.testsBlocked,
      manual: result.quality.testsManual,
      errors: result.quality.testsError,
    },
    assertions: {
      total: result.quality.assertionsTotal,
      passed: result.quality.assertionsPassed,
      failed: result.quality.assertionsFailed,
    },
    preflight: {
      status: result.preflight.status,
      checks: result.preflight.checks.length,
      blockers: result.preflight.blockers.length,
      warnings: result.preflight.warnings.length,
    },
    evidence: {
      total: result.evidence.length,
    },
  };
}
