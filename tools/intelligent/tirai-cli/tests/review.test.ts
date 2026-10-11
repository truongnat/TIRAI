import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { runReviewApprove, runReviewClarify } from '../src/commands/review.js';
import { getWorkspacePaths, type WorkspacePaths } from '../src/workspace.js';
import { readApprovalStore } from '../src/workflow.js';
import type { TestCase } from 'test-execution-orchestrator';

describe('review clarification workflow', () => {
  let root: string;
  let paths: WorkspacePaths;
  let original: TestCase;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(tmpdir(), 'tirai-review-'));
    paths = getWorkspacePaths(root);
    fs.mkdirSync(paths.artifactsDir, { recursive: true });
    fs.mkdirSync(path.join(paths.workspace, 'workflow'), { recursive: true });
    fs.writeFileSync(
      path.join(paths.artifactsDir, 'contract.json'),
      JSON.stringify({ metadata: { contractFingerprint: 'spec-fingerprint-1' } }),
    );
    original = {
      id: 'TC-1',
      scenarioId: 'SC-1',
      requirementIds: ['REQ-1'],
      title: 'Open order list',
      objective: 'Verify the order list is visible.',
      type: 'ui',
      priority: 'medium',
      preconditions: [],
      inputs: [],
      dataNeeds: [],
      steps: [{ order: 1, action: 'Open the orders page' }],
      expectedResults: [{ description: 'Orders are visible', verificationType: 'ui' }],
      cleanup: [],
      automation: { status: 'ready', suggestedExecutor: 'ui', reasons: [] },
      provenance: [{ requirementId: 'REQ-1', contextId: 'CTX-1' }],
      confidence: 0.9,
    };
    fs.writeFileSync(paths.testCasesPath, JSON.stringify([original]));
    fs.writeFileSync(
      paths.testPlanPath,
      JSON.stringify({ schemaVersion: '1.0', scenarios: [], testCases: [original] }),
    );
    fs.writeFileSync(
      path.join(root, 'spec.md'),
      '# Orders\nThe orders page shows submitted orders.\n',
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('records an answer, revises only the generated case, and clears prior approval', async () => {
    await runReviewApprove({
      cwd: root,
      testCaseId: original.id,
      route: '/orders',
      reviewer: 'Tester',
    });
    const resolvedTestCase: TestCase = {
      ...original,
      objective: 'Verify the orders page shows submitted orders for the selected test tenant.',
      expectedResults: [
        { description: 'Submitted orders appear in the order list', verificationType: 'ui' },
      ],
    };
    const inputPath = path.join(root, 'clarification.json');
    fs.writeFileSync(
      inputPath,
      JSON.stringify({
        reviewId: 'review-1',
        testCaseId: original.id,
        questionId: 'Q-1',
        question: 'Which orders should the list show?',
        answer: 'Submitted orders in the selected test tenant.',
        resolvedTestCase,
      }),
    );
    const sourceBefore = fs.readFileSync(path.join(root, 'spec.md'), 'utf8');

    await runReviewClarify({ cwd: root, inputPath });

    const updatedCases = JSON.parse(fs.readFileSync(paths.testCasesPath, 'utf8')) as TestCase[];
    const updatedPlan = JSON.parse(fs.readFileSync(paths.testPlanPath, 'utf8')) as {
      testCases: TestCase[];
    };
    const clarificationStore = JSON.parse(
      fs.readFileSync(path.join(paths.workspace, 'workflow', 'clarifications.json'), 'utf8'),
    ) as { answers: Array<Record<string, unknown>> };
    expect(updatedCases[0]?.expectedResults[0]?.description).toBe(
      'Submitted orders appear in the order list',
    );
    expect(updatedPlan.testCases[0]?.objective).toContain('selected test tenant');
    expect(
      readApprovalStore(path.join(paths.workspace, 'workflow', 'approvals.json')).approvals,
    ).toEqual([]);
    expect(clarificationStore.answers[0]).toMatchObject({
      questionId: 'Q-1',
      testCaseId: 'TC-1',
      specFingerprint: 'spec-fingerprint-1',
    });
    expect(clarificationStore.answers[0]).not.toHaveProperty('resolvedTestCase');
    expect(fs.readFileSync(path.join(root, 'spec.md'), 'utf8')).toBe(sourceBefore);
  });

  it('rejects a clarification that changes source requirement provenance', async () => {
    const inputPath = path.join(root, 'clarification.json');
    fs.writeFileSync(
      inputPath,
      JSON.stringify({
        reviewId: 'review-2',
        testCaseId: original.id,
        questionId: 'Q-2',
        question: 'Which orders are in scope?',
        answer: 'Only submitted orders.',
        resolvedTestCase: { ...original, provenance: [{ requirementId: 'REQ-OTHER' }] },
      }),
    );

    await expect(runReviewClarify({ cwd: root, inputPath })).rejects.toThrow(
      'preserve the case specification requirement links and provenance',
    );
    const currentCases = JSON.parse(fs.readFileSync(paths.testCasesPath, 'utf8')) as TestCase[];
    expect(currentCases[0]?.provenance).toEqual(original.provenance);
    expect(fs.existsSync(path.join(paths.workspace, 'workflow', 'clarifications.json'))).toBe(
      false,
    );
  });

  it('rejects literal credentials in clarified test inputs', async () => {
    const inputPath = path.join(root, 'clarification.json');
    fs.writeFileSync(
      inputPath,
      JSON.stringify({
        reviewId: 'review-3',
        testCaseId: original.id,
        questionId: 'Q-3',
        question: 'Which username should the test account use?',
        answer: 'Use the configured test account username.',
        resolvedTestCase: {
          ...original,
          inputs: [{ name: 'username', value: 'sensitive-literal' }],
        },
      }),
    );

    await expect(runReviewClarify({ cwd: root, inputPath })).rejects.toThrow(
      'literal credential value',
    );
    expect(JSON.parse(fs.readFileSync(paths.testCasesPath, 'utf8'))).toEqual([original]);
    expect(fs.existsSync(path.join(paths.workspace, 'workflow', 'clarifications.json'))).toBe(
      false,
    );
  });
});
