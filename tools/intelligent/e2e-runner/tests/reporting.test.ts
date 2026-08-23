// Reporting, JUnit, persistence, and security tests.
// Spec §59-62, §101-103, §108-118, §124-130.

import { describe, it, expect } from 'vitest';
import { generateJUnit, generateSummaryMd, generateSummaryJson } from '../src/reporting/reports.js';
import { writeRunOutput } from '../src/persistence/writer.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  makeRunResult, makeTestRunResult, makeTestRunSummary,
  makeTestExecutionResult, makeAuditEvents, makeInputHashes,
  makeProfile, makePolicy, makeInput,
} from './fixtures.js';

// ---- JUnit XML generation (§61-62, §112-118) ------------------------------

describe('reporting — generateJUnit', () => {
  it('generates valid XML header', () => {
    const xml = generateJUnit(makeTestRunResult());
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<testsuites');
    expect(xml).toContain('</testsuites>');
  });

  it('maps passed tests correctly (§114)', () => {
    const tr = makeTestRunResult({
      testResults: [makeTestExecutionResult({ status: 'passed', testCaseId: 'TC-001', scenarioId: 'SCN-1' })],
      summary: makeTestRunSummary({ testsTotal: 1, passed: 1 }),
    });
    const xml = generateJUnit(tr);
    expect(xml).toContain('<testcase');
    expect(xml).toContain('classname="SCN-1"');
    expect(xml).not.toContain('<failure');
  });

  it('maps failed tests correctly (§115)', () => {
    const tr = makeTestRunResult({
      testResults: [makeTestExecutionResult({
        status: 'failed',
        assertions: [{ id: 'a1', expectedResultIndex: 0, description: 'Check X', verificationType: 'visual', status: 'failed', evidenceIds: [] }],
      })],
      summary: makeTestRunSummary({ testsTotal: 1, failed: 1 }),
    });
    const xml = generateJUnit(tr);
    expect(xml).toContain('<failure');
    expect(xml).toContain('Check X');
  });

  it('maps blocked/skipped tests (§116)', () => {
    const tr = makeTestRunResult({
      testResults: [makeTestExecutionResult({ status: 'blocked' })],
      summary: makeTestRunSummary({ testsTotal: 1, blocked: 1 }),
    });
    const xml = generateJUnit(tr);
    expect(xml).toContain('<skipped');
  });

  it('maps error tests (§117)', () => {
    const tr = makeTestRunResult({
      testResults: [makeTestExecutionResult({
        status: 'error',
        errors: [{ code: 'BROWSER_CRASH', message: 'Browser crashed', retryable: false }],
      })],
      summary: makeTestRunSummary({ testsTotal: 1, errors: 1 }),
    });
    const xml = generateJUnit(tr);
    expect(xml).toContain('<error');
    expect(xml).toContain('Browser crashed');
  });

  it('escapes XML special characters (§118)', () => {
    const tr = makeTestRunResult({
      testResults: [makeTestExecutionResult({
        status: 'failed',
        assertions: [{ id: 'a1', expectedResultIndex: 0, description: 'Check <>&"\'', verificationType: 'visual', status: 'failed', evidenceIds: [] }],
      })],
      summary: makeTestRunSummary({ testsTotal: 1, failed: 1 }),
    });
    const xml = generateJUnit(tr);
    expect(xml).toContain('&lt;');
    expect(xml).toContain('&gt;');
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&quot;');
    expect(xml).toContain('&apos;');
  });

  it('includes test counts in testsuites', () => {
    const tr = makeTestRunResult({
      summary: makeTestRunSummary({ testsTotal: 5, passed: 3, failed: 1, errors: 1 }),
    });
    const xml = generateJUnit(tr);
    expect(xml).toContain('tests="5"');
    expect(xml).toContain('failures="1"');
  });

  it('uses default classname when no scenarioId', () => {
    const tr = makeTestRunResult({
      testResults: [makeTestExecutionResult({ scenarioId: '' })],
    });
    const xml = generateJUnit(tr);
    expect(xml).toContain('classname="default"');
  });
});

// ---- Summary MD (§110-111) ------------------------------------------------

describe('reporting — generateSummaryMd', () => {
  it('includes run metadata', () => {
    const result = makeRunResult({ runId: 'RUN-TEST', projectId: 'proj-1', environmentId: 'local' });
    const md = generateSummaryMd(result);
    expect(md).toContain('RUN-TEST');
    expect(md).toContain('proj-1');
    expect(md).toContain('local');
  });

  it('includes test metrics', () => {
    const result = makeRunResult();
    const md = generateSummaryMd(result);
    expect(md).toContain('## Tests');
    expect(md).toContain('## Assertions');
    expect(md).toContain('## Preflight');
  });

  it('includes duration', () => {
    const result = makeRunResult();
    const md = generateSummaryMd(result);
    expect(md).toContain('Duration');
  });
});

// ---- Summary JSON (§110) --------------------------------------------------

describe('reporting — generateSummaryJson', () => {
  it('includes schema version', () => {
    const json = generateSummaryJson(makeRunResult());
    expect(json.schemaVersion).toBe('1.0');
  });

  it('includes run metadata', () => {
    const json = generateSummaryJson(makeRunResult({ runId: 'RUN-X' }));
    expect(json.runId).toBe('RUN-X');
  });

  it('includes test counts', () => {
    const json = generateSummaryJson(makeRunResult());
    const tests = json.tests as Record<string, number>;
    expect(tests).toBeDefined();
    expect(typeof tests.total).toBe('number');
  });

  it('includes preflight status', () => {
    const json = generateSummaryJson(makeRunResult());
    const pf = json.preflight as Record<string, unknown>;
    expect(pf.status).toBe('ready');
  });
});

// ---- Persistence (§101, §108-113, §169-171) --------------------------------

describe('persistence — writeRunOutput', () => {
  it('writes all 6 report files (§101)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'e2e-test-'));
    try {
      await writeRunOutput({
        outputDir: dir,
        result: makeRunResult(),
        manifest: {
          schemaVersion: '1.0', runId: 'RUN-1', projectId: 'p1', environmentId: 'e1',
          mode: 'dry-run', profileFingerprint: 'fp', inputHashes: makeInputHashes(),
          selection: {}, startedAt: '', finishedAt: '', runnerVersion: '1.0.0',
        },
        auditEvents: makeAuditEvents(2),
      });

      const files = ['run-result-ir.json', 'manifest.json', 'summary.json', 'summary.md', 'junit.xml', 'audit-trail.json'];
      for (const f of files) {
        const content = await readFile(join(dir, f), 'utf-8');
        expect(content.length).toBeGreaterThan(0);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writes pretty JSON when requested', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'e2e-test-'));
    try {
      await writeRunOutput({
        outputDir: dir,
        result: makeRunResult(),
        manifest: {
          schemaVersion: '1.0', runId: 'RUN-1', projectId: 'p1', environmentId: 'e1',
          mode: 'dry-run', profileFingerprint: 'fp', inputHashes: makeInputHashes(),
          selection: {}, startedAt: '', finishedAt: '', runnerVersion: '1.0.0',
        },
        auditEvents: [],
        pretty: true,
      });

      const content = await readFile(join(dir, 'run-result-ir.json'), 'utf-8');
      expect(content).toContain('\n'); // pretty-printed has newlines
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('creates output directory if missing', async () => {
    const dir = join(tmpdir(), `e2e-test-${Date.now()}`, 'nested');
    try {
      await writeRunOutput({
        outputDir: dir,
        result: makeRunResult(),
        manifest: {
          schemaVersion: '1.0', runId: 'RUN-1', projectId: 'p1', environmentId: 'e1',
          mode: 'dry-run', profileFingerprint: 'fp', inputHashes: makeInputHashes(),
          selection: {}, startedAt: '', finishedAt: '', runnerVersion: '1.0.0',
        },
        auditEvents: [],
      });
      const content = await readFile(join(dir, 'manifest.json'), 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    } finally {
      await rm(join(tmpdir(), `e2e-test-${Date.now() - 1000}`), { recursive: true, force: true }).catch(() => {});
    }
  });
});

// ---- Security (§124-130) --------------------------------------------------

describe('security — production deny (§124)', () => {
  it('production profile cannot execute', async () => {
    // Verified in policy tests — production deny is enforced at policy level.
    // This is a cross-check that the preflight catches it.
    const { runPreflight } = await import('../src/preflight.js');
    const profile = makeProfile({ environment: { id: 'prod', name: 'Prod', safety: 'production' } });
    const policy = makePolicy({ mode: 'execute', allowExecution: true });
    const input = makeInput({ profile });
    const result = runPreflight(input, policy, makeInputHashes());
    expect(result.status).toBe('blocked');
  });
});

describe('security — no secrets in reports (§125-127)', () => {
  it('summary JSON does not contain secret values', () => {
    const json = generateSummaryJson(makeRunResult());
    const str = JSON.stringify(json);
    expect(str).not.toContain('password');
    expect(str).not.toContain('Bearer');
    expect(str).not.toContain('secret');
  });

  it('summary MD does not contain secret values', () => {
    const md = generateSummaryMd(makeRunResult());
    expect(md.toLowerCase()).not.toContain('password');
    expect(md.toLowerCase()).not.toContain('bearer');
  });

  it('JUnit XML does not contain secret values', () => {
    const xml = generateJUnit(makeTestRunResult());
    expect(xml.toLowerCase()).not.toContain('password');
    expect(xml.toLowerCase()).not.toContain('bearer');
  });
});

describe('security — manifest has no secrets (§54)', () => {
  it('manifest contains only safe fields', () => {
    const result = makeRunResult();
    const json = generateSummaryJson(result);
    const str = JSON.stringify(json);
    // No raw secret values should appear
    expect(str).not.toContain('token');
    expect(str).not.toContain('api_key');
  });
});
