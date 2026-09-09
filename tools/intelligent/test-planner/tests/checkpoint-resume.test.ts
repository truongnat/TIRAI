// ---------------------------------------------------------------------------
// Checkpoint / resume tests
// ---------------------------------------------------------------------------
// Verify that:
// 1. Zero-token resume: all checkpoints valid → 0 AI calls
// 2. Partial resume: only missing stage triggers AI calls
// 3. Failed stage output is NOT persisted as checkpoint

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FakeAIProvider } from 'ai-provider';
import {
  VALID_REQUIREMENT_IR_DIR,
  coverageCandidate,
  scenarioCandidate,
  testCaseCandidate,
  createTempOutput,
} from './fixtures/helpers.js';
import { buildTestPlan } from '../src/planner.js';
import { writeStageCheckpoint, writeCheckpointMeta } from '../src/persistence/checkpoint.js';
import { computeFingerprint } from '../src/fingerprint.js';
import { loadRequirementIRContent } from '../src/persistence/loader.js';
import { TEST_PLANNER_PROMPT_VERSION } from '../src/prompts/system.js';

/**
 * Helper: pre-populate checkpoints + write matching fingerprint meta
 * so that resume validation passes.
 */
function seedCheckpoints(
  outputDir: string,
  inputDir: string,
  providerName: string,
  opts: {
    coverage?: Parameters<typeof writeStageCheckpoint>[2];
    scenarios?: Parameters<typeof writeStageCheckpoint>[2];
    testCases?: Parameters<typeof writeStageCheckpoint>[2];
  },
): void {
  const content = loadRequirementIRContent(inputDir);
  const fp = computeFingerprint(content, TEST_PLANNER_PROMPT_VERSION, providerName);
  writeCheckpointMeta(outputDir, fp);

  if (opts.coverage) writeStageCheckpoint(outputDir, 'coverage', opts.coverage);
  if (opts.scenarios) writeStageCheckpoint(outputDir, 'scenarios', opts.scenarios);
  if (opts.testCases) writeStageCheckpoint(outputDir, 'testCases', opts.testCases);
}

// ===========================================================================
// 1. ZERO-TOKEN RESUME TEST
// ===========================================================================

describe('Checkpoint – zero-token resume', () => {
  it('all checkpoints valid + resume → 0 AI calls', async () => {
    const tmpOutput = createTempOutput();

    // Pre-populate all 3 checkpoints with matching fingerprint
    seedCheckpoints(tmpOutput, VALID_REQUIREMENT_IR_DIR, 'fake', {
      coverage: {
        coverageCandidates: [coverageCandidate('REQ-0001', ['positive'])],
        unresolvedCandidates: [],
      },
      scenarios: [
        scenarioCandidate('SCN-CAND-001', 'Valid username', ['REQ-0001']),
      ],
      testCases: [
        testCaseCandidate('TC-CAND-001', 'SCN-CAND-001', ['REQ-0001']),
      ],
    });

    // Provider with NO queued responses – if called, it will throw
    const provider = new FakeAIProvider({
      name: 'fake',
      model: 'fake-model',
      responses: [],
    });

    const ir = await buildTestPlan(VALID_REQUIREMENT_IR_DIR, provider, {
      outputDir: tmpOutput,
      resume: true,
    });

    // Verify 0 AI calls
    expect(provider.requestLog.length).toBe(0);

    // Verify output is still valid
    expect(ir.scenarios.length).toBe(1);
    expect(ir.testCases.length).toBe(1);
    expect(ir.scenarios[0]!.id).toBe('SCN-0001');
    expect(ir.testCases[0]!.id).toBe('TC-0001');

    fs.rmSync(tmpOutput, { recursive: true });
  });

  it('resume=false with same checkpoints still calls AI', async () => {
    const tmpOutput = createTempOutput();

    // Pre-populate checkpoints (no meta needed – resume=false ignores them)
    seedCheckpoints(tmpOutput, VALID_REQUIREMENT_IR_DIR, 'fake', {
      coverage: {
        coverageCandidates: [coverageCandidate('REQ-0001', ['positive'])],
        unresolvedCandidates: [],
      },
      scenarios: [
        scenarioCandidate('SCN-CAND-001', 'Valid username', ['REQ-0001']),
      ],
      testCases: [
        testCaseCandidate('TC-CAND-001', 'SCN-CAND-001', ['REQ-0001']),
      ],
    });

    // Provider WITH responses – should be consumed when resume=false
    const provider = new FakeAIProvider({
      name: 'fake',
      model: 'fake-model',
      responses: [
        { coverageCandidates: [], unresolvedCandidates: [] }, // coverage
        { scenarios: [] }, // scenario
        { testCases: [], additionalDataNeeds: [] }, // test case
      ],
    });

    await buildTestPlan(VALID_REQUIREMENT_IR_DIR, provider, {
      outputDir: tmpOutput,
      resume: false,
    });

    // All 3 stages should have called AI
    expect(provider.requestLog.length).toBe(3);

    fs.rmSync(tmpOutput, { recursive: true });
  });
});

// ===========================================================================
// 2. PARTIAL RESUME TEST
// ===========================================================================

describe('Checkpoint – partial resume', () => {
  it('coverage + scenario checkpoints exist, test-case missing → only test-case AI runs', async () => {
    const tmpOutput = createTempOutput();

    // Pre-populate coverage and scenario checkpoints only (no test-case)
    seedCheckpoints(tmpOutput, VALID_REQUIREMENT_IR_DIR, 'fake', {
      coverage: {
        coverageCandidates: [coverageCandidate('REQ-0001', ['positive'])],
        unresolvedCandidates: [],
      },
      scenarios: [
        scenarioCandidate('SCN-CAND-001', 'Valid username', ['REQ-0001']),
      ],
    });

    // Provider with exactly 1 response (for test-case generation only)
    const provider = new FakeAIProvider({
      name: 'fake',
      model: 'fake-model',
      responses: [
        {
          testCases: [
            {
              temporaryId: 'TC-CAND-001',
              scenarioTemporaryId: 'SCN-CAND-001',
              requirementIds: ['REQ-0001'],
              title: 'Enter valid username',
              objective: 'Verify valid input',
              type: 'ui',
              priority: 'high',
              preconditions: [],
              inputs: [{ name: 'username', valueStrategy: 'valid' }],
              dataNeeds: [],
              steps: [{ order: 1, action: 'Enter username' }],
              expectedResults: [{ description: 'Accepted', verificationType: 'ui' }],
              cleanup: [],
              automation: { status: 'ready', suggestedExecutor: 'ui', reasons: [] },
              provenance: [{ requirementId: 'REQ-0001' }],
              confidence: 0.9,
            },
          ],
          additionalDataNeeds: [],
        },
      ],
      usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75 },
    });

    const ir = await buildTestPlan(VALID_REQUIREMENT_IR_DIR, provider, {
      outputDir: tmpOutput,
      resume: true,
    });

    // Only 1 AI call (test-case generation)
    expect(provider.requestLog.length).toBe(1);

    // Output should have scenarios from checkpoint + test cases from AI
    expect(ir.scenarios.length).toBe(1);
    expect(ir.testCases.length).toBe(1);

    fs.rmSync(tmpOutput, { recursive: true });
  });

  it('only coverage checkpoint exists → scenario + test-case AI runs', async () => {
    const tmpOutput = createTempOutput();

    // Pre-populate only coverage checkpoint
    seedCheckpoints(tmpOutput, VALID_REQUIREMENT_IR_DIR, 'fake', {
      coverage: {
        coverageCandidates: [coverageCandidate('REQ-0001', ['positive'])],
        unresolvedCandidates: [],
      },
    });

    // Provider with 2 responses (scenario + test-case)
    const provider = new FakeAIProvider({
      name: 'fake',
      model: 'fake-model',
      responses: [
        {
          scenarios: [
            scenarioCandidate('SCN-CAND-001', 'Valid username', ['REQ-0001']),
          ],
        },
        {
          testCases: [
            testCaseCandidate('TC-CAND-001', 'SCN-CAND-001', ['REQ-0001']),
          ],
          additionalDataNeeds: [],
        },
      ],
      usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75 },
    });

    const ir = await buildTestPlan(VALID_REQUIREMENT_IR_DIR, provider, {
      outputDir: tmpOutput,
      resume: true,
    });

    // 2 AI calls: scenario + test-case (coverage skipped)
    expect(provider.requestLog.length).toBe(2);
    expect(ir.scenarios.length).toBe(1);
    expect(ir.testCases.length).toBe(1);

    fs.rmSync(tmpOutput, { recursive: true });
  });
});

// ===========================================================================
// 3. FAILED-CHECKPOINT RULE
// ===========================================================================

describe('Checkpoint – failed stage not persisted', () => {
  it('no test-case checkpoint written when AI fails', async () => {
    const tmpOutput = createTempOutput();

    // Pre-populate coverage + scenario checkpoints
    seedCheckpoints(tmpOutput, VALID_REQUIREMENT_IR_DIR, 'fake', {
      coverage: {
        coverageCandidates: [coverageCandidate('REQ-0001', ['positive'])],
        unresolvedCandidates: [],
      },
      scenarios: [
        scenarioCandidate('SCN-CAND-001', 'Valid username', ['REQ-0001']),
      ],
    });

    // Provider that throws on test-case generation
    const provider = new FakeAIProvider({
      name: 'fake',
      model: 'fake-model',
      error: new Error('AI failure'),
    });

    // Should throw
    await expect(
      buildTestPlan(VALID_REQUIREMENT_IR_DIR, provider, {
        outputDir: tmpOutput,
        resume: true,
        maxRepairAttempts: 0,
      }),
    ).rejects.toThrow();

    // Coverage + scenario checkpoints should still exist
    expect(fs.existsSync(path.join(tmpOutput, 'intermediate', 'coverage-analysis.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpOutput, 'intermediate', 'scenario-candidates.json'))).toBe(true);

    // Test-case checkpoint should NOT exist (stage failed)
    expect(fs.existsSync(path.join(tmpOutput, 'intermediate', 'test-case-candidates.json'))).toBe(false);

    fs.rmSync(tmpOutput, { recursive: true });
  });
});

// ===========================================================================
// 4. FINGERPRINT INVALIDATION
// ===========================================================================

describe('Checkpoint – fingerprint invalidation', () => {
  it('stale fingerprint (different prompt version) → all checkpoints invalidated', async () => {
    const tmpOutput = createTempOutput();

    // Write checkpoint meta with a STALE fingerprint (wrong prompt version)
    const content = loadRequirementIRContent(VALID_REQUIREMENT_IR_DIR);
    const staleFp = computeFingerprint(content, '0.9', 'fake'); // old prompt version
    writeCheckpointMeta(tmpOutput, staleFp);

    // Write valid checkpoint data
    writeStageCheckpoint(tmpOutput, 'coverage', {
      coverageCandidates: [coverageCandidate('REQ-0001', ['positive'])],
      unresolvedCandidates: [],
    });
    writeStageCheckpoint(tmpOutput, 'scenarios', [
      scenarioCandidate('SCN-CAND-001', 'Valid username', ['REQ-0001']),
    ]);
    writeStageCheckpoint(tmpOutput, 'testCases', [
      testCaseCandidate('TC-CAND-001', 'SCN-CAND-001', ['REQ-0001']),
    ]);

    // Provider with responses for all 3 stages
    const provider = new FakeAIProvider({
      name: 'fake',
      model: 'fake-model',
      responses: [
        { coverageCandidates: [], unresolvedCandidates: [] },
        { scenarios: [] },
        { testCases: [], additionalDataNeeds: [] },
      ],
    });

    await buildTestPlan(VALID_REQUIREMENT_IR_DIR, provider, {
      outputDir: tmpOutput,
      resume: true,
    });

    // Fingerprint mismatch → all checkpoints ignored → 3 AI calls
    expect(provider.requestLog.length).toBe(3);

    fs.rmSync(tmpOutput, { recursive: true });
  });

  it('no meta file but resume=true → checkpoints invalidated', async () => {
    const tmpOutput = createTempOutput();

    // Write checkpoint data WITHOUT meta file
    writeStageCheckpoint(tmpOutput, 'coverage', {
      coverageCandidates: [coverageCandidate('REQ-0001', ['positive'])],
      unresolvedCandidates: [],
    });
    writeStageCheckpoint(tmpOutput, 'scenarios', [
      scenarioCandidate('SCN-CAND-001', 'Valid username', ['REQ-0001']),
    ]);

    const provider = new FakeAIProvider({
      name: 'fake',
      model: 'fake-model',
      responses: [
        { coverageCandidates: [], unresolvedCandidates: [] },
        { scenarios: [] },
        { testCases: [], additionalDataNeeds: [] },
      ],
    });

    await buildTestPlan(VALID_REQUIREMENT_IR_DIR, provider, {
      outputDir: tmpOutput,
      resume: true,
    });

    // No meta file → can't validate → all checkpoints ignored → 3 AI calls
    expect(provider.requestLog.length).toBe(3);

    fs.rmSync(tmpOutput, { recursive: true });
  });
});
