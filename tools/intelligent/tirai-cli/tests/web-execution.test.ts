import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { defaultConfig } from '../src/config.js';
import { executeApprovedWebCases } from '../src/commands/web-execution.js';
import { getWorkspacePaths } from '../src/workspace.js';
import { caseFingerprint, getWorkflowPaths } from '../src/workflow.js';

const testCase = {
  id: 'TC-1',
  scenarioId: 'SC-1',
  requirementIds: ['REQ-1'],
  title: 'Load the todos page',
  objective: 'Verify the todos page loads.',
  type: 'ui' as const,
  priority: 'high' as const,
  preconditions: [],
  inputs: [],
  dataNeeds: [],
  steps: [{ order: 1, action: 'navigate to "/todos"', target: '/todos' }],
  expectedResults: [{ description: 'heading "Todos" is visible', verificationType: 'ui' }],
  cleanup: [],
  automation: { status: 'ready' as const, reasons: [] },
  provenance: [{ requirementId: 'REQ-1' }],
  confidence: 1,
};

function writeSpecAndApproval(root: string, specFingerprint: string): void {
  const paths = getWorkspacePaths(root);
  const workflow = getWorkflowPaths(paths);
  fs.mkdirSync(paths.artifactsDir, { recursive: true });
  fs.mkdirSync(workflow.directory, { recursive: true });
  fs.writeFileSync(path.join(paths.artifactsDir, 'contract.json'), JSON.stringify({
    metadata: { contractFingerprint: 'current-spec' },
  }));
  fs.writeFileSync(workflow.approvals, JSON.stringify({
    schemaVersion: '1.0',
    approvals: [{
      testCaseId: testCase.id,
      fingerprint: caseFingerprint(testCase),
      route: '/todos',
      reviewer: 'reviewer',
      approvedAt: new Date(0).toISOString(),
      specFingerprint,
    }],
  }));
}

describe('approved web execution safety gates', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(tmpdir(), 'tirai-web-execution-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
  it('rejects approval fingerprinted against a previous specification', async () => {
    writeSpecAndApproval(root, 'old-spec');
    await expect(executeApprovedWebCases({
      paths: getWorkspacePaths(root),
      config: defaultConfig(root),
      environment: 'local',
      environmentConfig: { baseUrl: 'http://localhost:4173' },
      testCases: [testCase],
      selectedCaseIds: [testCase.id],
      dedicatedTestTenantConfirmed: true,
    })).rejects.toThrow(/specification changed/i);
  });
  it('requires cleanup when a click target names a mutating control', async () => {
    writeSpecAndApproval(root, 'current-spec');
    const deletingCase = {
      ...testCase,
      steps: [...testCase.steps, { order: 2, action: 'click the control', target: 'Delete todo: sample' }],
    };
    await expect(executeApprovedWebCases({
      paths: getWorkspacePaths(root),
      config: defaultConfig(root),
      environment: 'local',
      environmentConfig: { baseUrl: 'http://localhost:4173' },
      testCases: [deletingCase],
      selectedCaseIds: [deletingCase.id],
      dedicatedTestTenantConfirmed: true,
    })).rejects.toThrow(/no cleanup plan/i);
  });

  it('does not treat waiting for an Add button as a mutation', async () => {
    writeSpecAndApproval(root, 'current-spec');
    const workflow = getWorkflowPaths(getWorkspacePaths(root));
    fs.writeFileSync(workflow.approvals, JSON.stringify({ schemaVersion: '1.0', approvals: [] }));
    const waitingCase = {
      ...testCase,
      title: 'Wait for the Add button',
      objective: 'Wait for the form control to appear.',
      steps: [{ order: 1, action: 'wait for the Add button', target: 'Add' }],
    };
    await expect(executeApprovedWebCases({
      paths: getWorkspacePaths(root),
      config: defaultConfig(root),
      environment: 'local',
      environmentConfig: { baseUrl: 'http://localhost:4173' },
      testCases: [waitingCase],
      selectedCaseIds: [waitingCase.id],
      dedicatedTestTenantConfirmed: true,
    })).rejects.toThrow(/has no human approval/i);
  });

  it('requires cleanup when a step uses an unrecognized action verb', async () => {
    writeSpecAndApproval(root, 'current-spec');
    const unknownVerbCase = {
      ...testCase,
      steps: [...testCase.steps, { order: 2, action: 'frobnicate the widget', target: 'widget' }],
    };
    await expect(executeApprovedWebCases({
      paths: getWorkspacePaths(root),
      config: defaultConfig(root),
      environment: 'local',
      environmentConfig: { baseUrl: 'http://localhost:4173' },
      testCases: [unknownVerbCase],
      selectedCaseIds: [unknownVerbCase.id],
      dedicatedTestTenantConfirmed: true,
    })).rejects.toThrow(/no cleanup plan/i);
  });

  it('keeps approval valid when only cosmetic fields change but rejects step edits', async () => {
    writeSpecAndApproval(root, 'current-spec');
    const cosmetic = { ...testCase, title: 'Retitled', confidence: 0.4 };
    expect(caseFingerprint(cosmetic)).toBe(caseFingerprint(testCase));
    const edited = { ...testCase, steps: [{ order: 1, action: 'navigate to "/other"', target: '/other' }] };
    expect(caseFingerprint(edited)).not.toBe(caseFingerprint(testCase));
  });

  it('rejects production before inspecting approvals or launching a browser', async () => {
    await expect(
      executeApprovedWebCases({
        paths: getWorkspacePaths(root),
        config: defaultConfig(root),
        environment: 'production',
        environmentConfig: { baseUrl: 'https://app.example.com' },
        testCases: [],
        selectedCaseIds: [],
        dedicatedTestTenantConfirmed: true,
      }),
    ).rejects.toThrow(/production/i);
  });

  it('rejects a production-like hostname even when it is labelled staging', async () => {
    await expect(
      executeApprovedWebCases({
        paths: getWorkspacePaths(root),
        config: defaultConfig(root),
        environment: 'staging',
        environmentConfig: { baseUrl: 'https://production.example.com' },
        testCases: [],
        selectedCaseIds: [],
        dedicatedTestTenantConfirmed: true,
      }),
    ).rejects.toThrow('production-like hostnames');
  });

  it('requires explicit dedicated-test-tenant confirmation before any browser work', async () => {
    await expect(
      executeApprovedWebCases({
        paths: getWorkspacePaths(root),
        config: defaultConfig(root),
        environment: 'staging',
        environmentConfig: { baseUrl: 'https://staging.example.com' },
        testCases: [],
        selectedCaseIds: ['TC-1'],
        dedicatedTestTenantConfirmed: false,
      }),
    ).rejects.toThrow('--confirm-dedicated-test-tenant');
  });
});
