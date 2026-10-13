import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { runArtifactImport } from '../src/commands/artifact.js';
import { runInit } from '../src/commands/init.js';
import { getWorkspacePaths } from '../src/workspace.js';
import { loadState } from '../src/state.js';

const minimalSemanticIR = {
  schemaVersion: '1.0',
  status: 'complete',
  document: { title: 'Spec', provenance: [] },
  sections: [],
  entities: [],
  flows: [],
  rules: [],
  relationships: [],
  unresolved: [],
  analysis: {},
};

const minimalRequirements = {
  schemaVersion: '1.0',
  document: { title: 'Spec', provenance: [] },
  requirements: [],
  unresolved: [],
  conflicts: [],
  quality: {},
};

const minimalTestPlan = {
  schemaVersion: '1.0',
  scope: { requirementIds: [], objective: 'Verify behavior', assumptions: [], exclusions: [] },
  requirementCoverage: [],
  scenarios: [{ id: 'SCN-1', title: 'Scenario' }],
  testCases: [{ id: 'TC-1', title: 'Case' }],
  dataNeeds: [],
  unresolved: [],
  quality: {},
};

const minimalTestCases = [{
  id: 'TC-1',
  scenarioId: 'SCN-1',
  title: 'Reject order when quantity exceeds stock',
  objective: 'Submit an order above available stock.',
  type: 'api',
  priority: 'high',
  requirementIds: ['REQ-1'],
  preconditions: [],
  inputs: [],
  dataNeeds: [],
  steps: [{ order: 1, action: 'Submit order', target: 'order service' }],
  expectedResults: [{ description: 'Order rejected.', verificationType: 'api' }],
  cleanup: [],
  automation: { status: 'ready', reasons: [] },
  provenance: [],
  confidence: 1,
}];

const minimalContract = {
  schemaVersion: '1.0',
  contractId: 'contract-test-1',
  contractVersion: 1,
  project: { id: 'proj-test', name: 'Test Project' },
  document: { title: 'Test spec' },
  sources: [],
  rawContexts: [],
  requirements: [],
  businessFlows: [],
  ui: [],
  apis: [],
  entities: [],
  modules: [],
  scenarios: [],
  testCases: [{ id: 'TC-1', kind: 'test-case', title: 'Case', relatedIds: [], provenance: [], confidence: 1 }],
  artifacts: [],
  unresolved: [],
  conflicts: [],
  quality: {
    requirements: 0,
    requirementsCovered: 0,
    scenarios: 0,
    testCases: 1,
    automationReady: 0,
    unresolved: 0,
    conflicts: 0,
    provenanceCoverage: 1,
  },
  metadata: {
    contractFingerprint: 'pending',
    generatedAt: '2026-01-01T00:00:00.000Z',
    generatorVersion: 'test',
    promptVersions: [],
  },
};

describe('artifact import', () => {
  let root: string;
  let hostDir: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(tmpdir(), 'tirai-artifact-import-'));
    hostDir = path.join(root, 'host-artifacts');
    fs.mkdirSync(hostDir, { recursive: true });
    await runInit({ cwd: root });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeHostArtifact(name: string, value: unknown): string {
    const filePath = path.join(hostDir, name);
    fs.writeFileSync(filePath, JSON.stringify(value), 'utf8');
    return filePath;
  }

  it('imports semantic-ir into the canonical artifacts directory with an audit sidecar', async () => {
    const input = writeHostArtifact('semantic-ir.json', minimalSemanticIR);
    await runArtifactImport({ cwd: root, kind: 'semantic-ir', filePath: input });
    const paths = getWorkspacePaths(root);
    expect(fs.existsSync(path.join(paths.artifactsDir, 'semantic-ir.json'))).toBe(true);
    const audit = JSON.parse(fs.readFileSync(path.join(paths.artifactsDir, 'semantic-ir-import.json'), 'utf8'));
    expect(audit.kind).toBe('semantic-ir');
    expect(audit.inputSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('imports requirements, test-plan, and testcases artifacts', async () => {
    const paths = getWorkspacePaths(root);
    await runArtifactImport({ cwd: root, kind: 'requirements', filePath: writeHostArtifact('requirements.json', minimalRequirements) });
    await runArtifactImport({ cwd: root, kind: 'test-plan', filePath: writeHostArtifact('test-plan.json', minimalTestPlan) });
    await runArtifactImport({ cwd: root, kind: 'testcases', filePath: writeHostArtifact('testcases.json', minimalTestCases) });
    expect(fs.existsSync(path.join(paths.artifactsDir, 'requirements.json'))).toBe(true);
    expect(fs.existsSync(path.join(paths.artifactsDir, 'test-plan.json'))).toBe(true);
    expect(fs.existsSync(path.join(paths.artifactsDir, 'testcases.json'))).toBe(true);
    const state = loadState(paths);
    expect(state?.testPlan?.testCaseCount).toBe(1);
    expect(state?.testPlan?.scenarioCount).toBe(1);
  });

  it('imports a contract through the shared contract importer', async () => {
    const input = writeHostArtifact('contract.json', minimalContract);
    await runArtifactImport({ cwd: root, kind: 'contract', filePath: input });
    const paths = getWorkspacePaths(root);
    expect(fs.existsSync(path.join(paths.artifactsDir, 'contract.json'))).toBe(true);
    expect(fs.existsSync(path.join(paths.artifactsDir, 'contract-import.json'))).toBe(true);
    const contract = JSON.parse(fs.readFileSync(path.join(paths.artifactsDir, 'contract.json'), 'utf8'));
    expect(contract.contractId).toBe('contract-test-1');
    expect(contract.metadata.contractFingerprint).not.toBe('pending');
  });

  it('rejects an artifact that fails structural validation', async () => {
    const bad = writeHostArtifact('bad-semantic-ir.json', { schemaVersion: '1.0', status: 'complete' });
    await expect(runArtifactImport({ cwd: root, kind: 'semantic-ir', filePath: bad })).rejects.toThrow(/Invalid semantic-ir/);
    const paths = getWorkspacePaths(root);
    expect(fs.existsSync(path.join(paths.artifactsDir, 'semantic-ir.json'))).toBe(false);
  });
  it('rejects incomplete test cases before storing them', async () => {
    const bad = writeHostArtifact('incomplete-testcases.json', [{ id: 'TC-1', title: 'Case' }]);
    await expect(runArtifactImport({ cwd: root, kind: 'testcases', filePath: bad }))
      .rejects.toThrow(/requires non-empty id, scenarioId, title, and objective/);
    expect(fs.existsSync(path.join(getWorkspacePaths(root).artifactsDir, 'testcases.json'))).toBe(false);
  });


  it('rejects malformed JSON without writing the artifact', async () => {
    const badPath = path.join(hostDir, 'broken.json');
    fs.writeFileSync(badPath, '{not json', 'utf8');
    await expect(runArtifactImport({ cwd: root, kind: 'testcases', filePath: badPath })).rejects.toThrow(/not valid JSON/);
    const paths = getWorkspacePaths(root);
    expect(fs.existsSync(path.join(paths.artifactsDir, 'testcases.json'))).toBe(false);
  });

  it('rejects unknown kinds and missing files', async () => {
    await expect(runArtifactImport({ cwd: root, kind: 'bogus', filePath: 'x.json' })).rejects.toThrow(/Unknown artifact kind/);
    await expect(runArtifactImport({ cwd: root, kind: 'requirements', filePath: 'missing.json' })).rejects.toThrow(/not found/i);
  });
});
