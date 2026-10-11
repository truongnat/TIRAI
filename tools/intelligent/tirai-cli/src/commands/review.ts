import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TestCase } from 'test-execution-orchestrator';
import { CliError } from '../errors.js';
import { atomicWriteJson, requireWorkspace } from '../workspace.js';
import {
  assertSecretReferences,
  ensurePrivateWorkspaceArtifactsIgnored,
  caseFingerprint,
  getWorkflowPaths,
  loadTestCases,
  readApprovalStore,
  resolveApprovedRoute,
  saveApprovalStore,
  specFingerprint,
} from '../workflow.js';

export interface ReviewApproveOptions {
  cwd: string;
  testCaseId: string;
  route: string;
  reviewer: string;
  json?: boolean;
}

export interface ReviewClarifyOptions {
  cwd: string;
  inputPath: string;
  json?: boolean;
}

interface ClarificationInput {
  reviewId: string;
  testCaseId: string;
  questionId: string;
  question: string;
  answer: string;
  resolvedTestCase: TestCase;
}

interface ClarificationRecord extends Omit<ClarificationInput, 'resolvedTestCase'> {
  specFingerprint: string;
  answeredAt: string;
}

interface ClarificationStore {
  schemaVersion: '1.0';
  answers: ClarificationRecord[];
}

export async function runReviewApprove(opts: ReviewApproveOptions): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  const route = resolveApprovedRoute('http://tirai.invalid', opts.route);
  const reviewer = opts.reviewer.trim();
  if (!reviewer) throw new CliError('INVALID_TARGET', 'Reviewer name is required.');
  const fingerprint = specFingerprint(paths);
  if (!fingerprint) throw new CliError('CONFIG_INVALID', 'A fingerprinted specification is required before case approval.');
  const testCase = loadTestCases(paths.testCasesPath).find((candidate) => candidate.id === opts.testCaseId);
  if (!testCase) throw new CliError('CONFIG_INVALID', `Test case not found: ${opts.testCaseId}`);
  const workflow = getWorkflowPaths(paths);
  const store = readApprovalStore(workflow.approvals);
  const approval = {
    testCaseId: testCase.id,
    fingerprint: caseFingerprint(testCase),
    route: new URL(route).pathname + new URL(route).search,
    reviewer,
    approvedAt: new Date().toISOString(),
    specFingerprint: fingerprint,
  };
  store.approvals = [...store.approvals.filter((entry) => entry.testCaseId !== testCase.id), approval];
  saveApprovalStore(workflow.approvals, store);
  if (opts.json) console.log(JSON.stringify({ status: 'approved', ...approval }, null, 2));
  else console.log(`Approved ${testCase.id} for route ${approval.route} by ${reviewer}.`);
}

export async function runReviewClarify(opts: ReviewClarifyOptions): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  ensurePrivateWorkspaceArtifactsIgnored(paths);
  const sourcePath = path.resolve(opts.cwd, opts.inputPath);
  if (!fs.existsSync(sourcePath)) throw new CliError('SOURCE_INPUT_ERROR', `Clarification file not found: ${sourcePath}`);
  let input: ClarificationInput;
  try {
    input = JSON.parse(fs.readFileSync(sourcePath, 'utf8')) as ClarificationInput;
  } catch (error) {
    throw new CliError('SOURCE_INPUT_ERROR', `Clarification file is not valid JSON: ${String(error)}`);
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new CliError('SOURCE_INPUT_ERROR', 'Clarification file must contain a JSON object.');
  }
  for (const key of ['reviewId', 'testCaseId', 'questionId', 'question', 'answer'] as const) {
    if (typeof input[key] !== 'string' || input[key].trim().length === 0) {
      throw new CliError('SOURCE_INPUT_ERROR', `Clarification file requires a non-empty ${key}.`);
    }
  }
  if (!input.resolvedTestCase || typeof input.resolvedTestCase !== 'object') {
    throw new CliError('SOURCE_INPUT_ERROR', 'Clarification file requires the reviewed resolvedTestCase object.');
  }
  const fingerprint = specFingerprint(paths);
  if (!fingerprint) throw new CliError('CONFIG_INVALID', 'A fingerprinted specification is required before recording a clarification.');
  const allTestCases = loadTestCases(paths.testCasesPath);
  const originalCase = allTestCases.find((testCase) => testCase.id === input.testCaseId);
  if (!originalCase) throw new CliError('CONFIG_INVALID', `Test case not found: ${input.testCaseId}`);
  validateResolvedCase(originalCase, input.resolvedTestCase);
  let testPlan: { testCases?: unknown[]; [key: string]: unknown };
  try {
    testPlan = JSON.parse(fs.readFileSync(paths.testPlanPath, 'utf8')) as { testCases?: unknown[]; [key: string]: unknown };
  } catch (error) {
    throw new CliError('CONFIG_INVALID', `Test plan is not valid JSON: ${String(error)}`);
  }
  if (!testPlan || typeof testPlan !== 'object' || Array.isArray(testPlan)) {
    throw new CliError('CONFIG_INVALID', 'Test plan must contain a JSON object.');
  }
  if (!Array.isArray(testPlan.testCases) || !testPlan.testCases.some((testCase) => (testCase as { id?: string }).id === input.testCaseId)) {
    throw new CliError('CONFIG_INVALID', `Test plan does not contain ${input.testCaseId}; re-ingest and re-plan before clarifying.`);
  }
  const updatedCases = allTestCases.map((testCase) => testCase.id === input.testCaseId ? input.resolvedTestCase : testCase);
  const updatedPlan = {
    ...testPlan,
    testCases: testPlan.testCases.map((testCase) => (testCase as { id?: string }).id === input.testCaseId ? input.resolvedTestCase : testCase),
  };
  const workflow = getWorkflowPaths(paths);
  let store: ClarificationStore = { schemaVersion: '1.0', answers: [] };
  if (fs.existsSync(workflow.clarifications)) {
    try {
      store = JSON.parse(fs.readFileSync(workflow.clarifications, 'utf8')) as ClarificationStore;
      if (store.schemaVersion !== '1.0' || !Array.isArray(store.answers)) throw new Error('Invalid clarification store shape.');
    } catch (error) {
      throw new CliError('CONFIG_INVALID', `Clarification store is invalid: ${String(error)}`);
    }
  }
  const record: ClarificationRecord = {
    reviewId: input.reviewId,
    testCaseId: input.testCaseId,
    questionId: input.questionId,
    question: input.question,
    answer: input.answer,
    specFingerprint: fingerprint,
    answeredAt: new Date().toISOString(),
  };
  store.answers = [...store.answers.filter((answer) => answer.questionId !== input.questionId || answer.reviewId !== input.reviewId), record];
  const approvalStore = readApprovalStore(workflow.approvals);
  approvalStore.approvals = approvalStore.approvals.filter((approval) => approval.testCaseId !== input.testCaseId);
  atomicWriteJson(paths.testCasesPath, updatedCases);
  atomicWriteJson(paths.testPlanPath, updatedPlan);
  saveApprovalStore(workflow.approvals, approvalStore);
  fs.mkdirSync(path.dirname(workflow.clarifications), { recursive: true });
  fs.writeFileSync(workflow.clarifications, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
  if (opts.json) console.log(JSON.stringify({ status: 'recorded', questionId: record.questionId, testCaseId: record.testCaseId, reviewId: record.reviewId, specFingerprint: record.specFingerprint }, null, 2));
  else console.log(`Recorded clarification ${record.questionId} for ${record.testCaseId} (${record.reviewId}).`);
}
function validateResolvedCase(original: TestCase, resolved: TestCase): void {
  if (resolved.id !== original.id || resolved.scenarioId !== original.scenarioId) {
    throw new CliError('SOURCE_INPUT_ERROR', 'A clarification may revise only the existing case; its case and scenario IDs must remain unchanged.');
  }
  if (!Array.isArray(resolved.requirementIds) || !Array.isArray(resolved.provenance)
    || JSON.stringify(resolved.requirementIds) !== JSON.stringify(original.requirementIds)
    || JSON.stringify(resolved.provenance) !== JSON.stringify(original.provenance)) {
    throw new CliError('SOURCE_INPUT_ERROR', 'A clarification must preserve the case specification requirement links and provenance.');
  }
  if (resolved.type !== 'ui' || !Array.isArray(resolved.steps) || resolved.steps.length === 0
    || resolved.steps.some((step) => typeof step?.action !== 'string' || !step.action.trim())
    || !Array.isArray(resolved.expectedResults) || resolved.expectedResults.length === 0
    || resolved.expectedResults.some((result) => typeof result?.description !== 'string' || !result.description.trim() || result.verificationType !== 'ui')
    || !Array.isArray(resolved.inputs) || resolved.inputs.some((input) => !input || typeof input.name !== 'string')
    || !Array.isArray(resolved.cleanup) || resolved.cleanup.some((cleanup) => !cleanup
      || typeof cleanup.description !== 'string' || !cleanup.description.trim()
      || typeof cleanup.target !== 'string' || !cleanup.target.trim())) {
    throw new CliError('SOURCE_INPUT_ERROR', 'The resolved case must be a complete UI test with actions, UI expectations, valid inputs, and explicit cleanup targets.');
  }
  assertSecretReferences(resolved);
}
