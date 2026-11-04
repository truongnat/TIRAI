import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { planArtifacts } from 'source-to-testcase';
import type { ContractIR } from 'contract-ir';
import { requireWorkspace } from '../workspace.js';
import { CliError } from '../errors.js';
import { resolveActiveTask, taskPaths, updateTask } from '../tasks.js';
import { updateState } from '../state.js';
import { runContractImport } from './contract.js';

const ARTIFACT_KINDS = ['semantic-ir', 'requirements', 'test-plan', 'testcases', 'contract'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

const KIND_FILE_NAMES: Record<ArtifactKind, string> = {
  'semantic-ir': 'semantic-ir.json',
  requirements: 'requirements.json',
  'test-plan': 'test-plan.json',
  testcases: 'testcases.json',
  contract: 'contract.json',
};

function invalidArtifact(kind: string, detail: string): CliError {
  return new CliError('CONFIG_INVALID', `Invalid ${kind} artifact: ${detail}`);
}

function asArtifactObject(value: unknown, kind: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidArtifact(kind, 'expected a JSON object.');
  }
  return value as Record<string, unknown>;
}

function requireArtifactArray(record: Record<string, unknown>, key: string, kind: string): unknown[] {
  const field = record[key];
  if (!Array.isArray(field)) throw invalidArtifact(kind, `missing required array "${key}".`);
  return field;
}

const SEMANTIC_IR_ARRAY_FIELDS = ['sections', 'entities', 'flows', 'rules', 'relationships', 'unresolved'];
const TEST_PLAN_ARRAY_FIELDS = ['requirementCoverage', 'scenarios', 'testCases', 'dataNeeds', 'unresolved'];

function validateSemanticIR(value: unknown): void {
  const record = asArtifactObject(value, 'semantic-ir');
  if (record.schemaVersion !== '1.0') throw invalidArtifact('semantic-ir', 'schemaVersion must be "1.0".');
  for (const key of SEMANTIC_IR_ARRAY_FIELDS) requireArtifactArray(record, key, 'semantic-ir');
  if (record.status !== 'complete' && record.status !== 'partial') {
    throw invalidArtifact('semantic-ir', 'status must be "complete" or "partial".');
  }
  if (typeof record.document !== 'object' || record.document === null) {
    throw invalidArtifact('semantic-ir', 'missing document object.');
  }
}

function validateRequirementsIR(value: unknown): void {
  const record = asArtifactObject(value, 'requirements');
  if (record.schemaVersion !== '1.0') throw invalidArtifact('requirements', 'schemaVersion must be "1.0".');
  requireArtifactArray(record, 'requirements', 'requirements');
  requireArtifactArray(record, 'unresolved', 'requirements');
  requireArtifactArray(record, 'conflicts', 'requirements');
}

function validateTestPlanIR(value: unknown): void {
  const record = asArtifactObject(value, 'test-plan');
  if (record.schemaVersion !== '1.0') throw invalidArtifact('test-plan', 'schemaVersion must be "1.0".');
  for (const key of TEST_PLAN_ARRAY_FIELDS) requireArtifactArray(record, key, 'test-plan');
  if (typeof record.scope !== 'object' || record.scope === null) {
    throw invalidArtifact('test-plan', 'missing scope object.');
  }
}

function validateTestCases(value: unknown): void {
  if (!Array.isArray(value)) {
    throw invalidArtifact('testcases', 'expected a JSON array of canonical test cases.');
  }
  const hasText = (item: unknown): item is string => typeof item === 'string' && item.trim().length > 0;
  const arrayOfRecords = (item: unknown, check: (record: Record<string, unknown>) => boolean): boolean =>
    Array.isArray(item) && item.every((entry) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return false;
      return check(entry as Record<string, unknown>);
    });

  for (const [index, entry] of value.entries()) {
    const invalid = (detail: string): never => {
      throw invalidArtifact('testcases', `entry ${index} ${detail}.`);
    };
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) invalid('must be an object');
    const record = entry as Record<string, unknown>;
    if (!hasText(record.id) || !hasText(record.scenarioId) || !hasText(record.title) || !hasText(record.objective)) {
      invalid('requires non-empty id, scenarioId, title, and objective');
    }
    if (!['ui', 'api', 'database', 'integration', 'manual', 'unknown'].includes(String(record.type))) {
      invalid('has an unsupported type');
    }
    if (!['critical', 'high', 'medium', 'low'].includes(String(record.priority))) {
      invalid('has an unsupported priority');
    }
    if (!Array.isArray(record.requirementIds) || !record.requirementIds.every(hasText)
      || !Array.isArray(record.inputs)
      || !arrayOfRecords(record.inputs, (input) => hasText(input.name)
        && ['fixed', 'valid', 'invalid', 'boundary', 'generated', 'existing-data', 'unknown'].includes(String(input.valueStrategy)))
      || !Array.isArray(record.dataNeeds)
      || !arrayOfRecords(record.dataNeeds, (need) => hasText(need.id) && hasText(need.description)
        && ['input', 'database-record', 'account', 'state', 'external-response', 'file', 'configuration', 'other'].includes(String(need.type))
        && Array.isArray(need.constraints) && need.constraints.every(hasText)
        && Array.isArray(need.relatedRequirementIds) && need.relatedRequirementIds.every(hasText))
      || !arrayOfRecords(record.preconditions, (precondition) => hasText(precondition.description)
        && Array.isArray(precondition.sourceRequirementIds) && precondition.sourceRequirementIds.every(hasText))
      || !arrayOfRecords(record.steps, (step) => Number.isInteger(step.order) && hasText(step.action)
        && (step.target === undefined || typeof step.target === 'string')
        && (step.input === undefined || typeof step.input === 'string'))
      || !arrayOfRecords(record.expectedResults, (result) => hasText(result.description)
        && ['ui', 'api', 'database', 'state', 'log', 'other'].includes(String(result.verificationType)))
      || !arrayOfRecords(record.cleanup, (cleanup) => hasText(cleanup.description)
        && (cleanup.target === undefined || hasText(cleanup.target))
        && (cleanup.steps === undefined || (Array.isArray(cleanup.steps) && cleanup.steps.every((s: unknown) => typeof s === 'object' && s !== null && hasText((s as { action?: unknown }).action)))))
      || !arrayOfRecords(record.provenance, (provenance) => hasText(provenance.requirementId))) {
      invalid('has a malformed required field or array entry');
    }
    const automationValue = record.automation;
    if (typeof automationValue !== 'object' || automationValue === null || Array.isArray(automationValue)) {
      invalid('has malformed automation readiness or confidence');
    }
    const automation = automationValue as Record<string, unknown>;
    if (!['ready', 'partially-ready', 'manual-only', 'unknown'].includes(String(automation.status))
      || !Array.isArray(automation.reasons) || !automation.reasons.every(hasText)
      || typeof record.confidence !== 'number' || !Number.isFinite(record.confidence)
      || record.confidence < 0 || record.confidence > 1) {
      invalid('has malformed automation readiness or confidence');
    }
  }
}

const KIND_VALIDATORS: Record<Exclude<ArtifactKind, 'contract'>, (value: unknown) => void> = {
  'semantic-ir': validateSemanticIR,
  requirements: validateRequirementsIR,
  'test-plan': validateTestPlanIR,
  testcases: validateTestCases,
};

/**
 * Import a host-agent-produced canonical artifact into the workspace.
 * Every kind is validated before it lands in .tirai/artifacts/ and each
 * import writes a <kind>-import.json audit sidecar next to the artifact.
 */
export async function runArtifactImport(opts: { cwd: string; kind: string; filePath: string; taskId?: string; json?: boolean }): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  const task = opts.taskId ? resolveActiveTask(paths, opts.taskId) : undefined;
  if (opts.taskId && !task) throw new CliError('TASK_NOT_FOUND', `Task not found: ${opts.taskId}`);
  if (!ARTIFACT_KINDS.includes(opts.kind as ArtifactKind)) {
    throw new CliError('INVALID_TARGET', `Unknown artifact kind "${opts.kind}". Expected one of: ${ARTIFACT_KINDS.join(' | ')}`);
  }
  const kind = opts.kind as ArtifactKind;
  if (!opts.filePath) {
    throw new CliError('INVALID_TARGET', `Usage: tirai artifact import ${kind} --file <path>`);
  }
  const inputPath = path.resolve(opts.cwd, opts.filePath);
  if (!fs.existsSync(inputPath)) throw new CliError('CONFIG_INVALID', `Artifact file not found: ${inputPath}`);
  if (kind === 'contract') {
    // Contract import already validates, finalizes, audits, and updates task state.
    await runContractImport({ cwd: opts.cwd, inputPath: opts.filePath, taskId: opts.taskId, json: opts.json });
    return;
  }
  let value: unknown;
  try { value = JSON.parse(fs.readFileSync(inputPath, 'utf8')); } catch (error) { throw new CliError('CONFIG_INVALID', `Artifact is not valid JSON: ${String(error)}`); }
  KIND_VALIDATORS[kind](value);
  const artifactsDir = task ? taskPaths(paths, task.id).artifacts : paths.artifactsDir;
  fs.mkdirSync(artifactsDir, { recursive: true });
  const destination = path.join(artifactsDir, KIND_FILE_NAMES[kind]);
  fs.writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  const audit = {
    schemaVersion: '1.0',
    kind,
    inputPath,
    inputSha256: createHash('sha256').update(fs.readFileSync(inputPath)).digest('hex'),
    importedAt: new Date().toISOString(),
  };
  const auditPath = path.join(artifactsDir, `${kind}-import.json`);
  fs.writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  if (kind === 'test-plan' || kind === 'testcases') {
    const plan = kind === 'test-plan' ? (value as { scenarios?: unknown[]; testCases?: unknown[] }) : undefined;
    updateState(paths, (s) => ({
      ...s,
      testPlan: {
        requirementCount: s.testPlan?.requirementCount ?? 0,
        scenarioCount: plan?.scenarios?.length ?? s.testPlan?.scenarioCount ?? 0,
        testCaseCount: (plan?.testCases ?? (value as unknown[])).length,
        ingestedAt: new Date().toISOString(),
      },
    }));
  }
  if (task && task.status === 'ingesting') updateTask(paths, task.id, { status: 'analyzed' });
  const result = { imported: true, kind, artifactPath: destination, auditPath };
  if (opts.json) console.log(JSON.stringify(result, null, 2)); else console.log(`Imported ${kind}: ${path.relative(paths.root, destination)}`);
}

export async function runArtifactPlan(opts: { cwd: string; contractPath?: string; taskId?: string; json?: boolean }): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  const task = opts.taskId ? resolveActiveTask(paths, opts.taskId) : undefined;
  if (opts.taskId && !task) throw new CliError('TASK_NOT_FOUND', `Task not found: ${opts.taskId}`);
  const artifactsDir = task ? taskPaths(paths, task.id).artifacts : paths.artifactsDir;
  const contractPath = opts.contractPath ? path.resolve(opts.cwd, opts.contractPath) : path.join(artifactsDir, 'contract.json');
  if (!fs.existsSync(contractPath)) throw new CliError('CONFIG_INVALID', `Contract not found: ${contractPath}`);
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8')) as ContractIR;
  const plan = planArtifacts(contract);
  const outputPath = path.join(artifactsDir, 'artifact-plan.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  if (task) updateTask(paths, task.id, { artifactManifestPath: path.relative(paths.root, outputPath) });
  if (opts.json) console.log(JSON.stringify({ ...plan, path: outputPath }, null, 2)); else console.log(`Artifact plan written: ${path.relative(paths.root, outputPath)} (${plan.strategy})`);
}

export async function runArtifactVerify(opts: { cwd: string; taskId?: string; json?: boolean }): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  const task = opts.taskId ? resolveActiveTask(paths, opts.taskId) : undefined;
  if (opts.taskId && !task) throw new CliError('TASK_NOT_FOUND', `Task not found: ${opts.taskId}`);
  const artifactRoot = task ? taskPaths(paths, task.id).artifacts : paths.artifactsDir;
  const manifestPath = path.join(artifactRoot, 'export-manifest.json');
  if (!fs.existsSync(manifestPath)) throw new CliError('CONFIG_INVALID', 'Export manifest not found. Run `tirai export` first.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { artifacts?: Array<{ path: string; contentHash: string }> };
  const checks = (manifest.artifacts ?? []).map((artifact) => {
    // Export manifests always store paths relative to the project root,
    // including manifests generated inside an isolated task workspace.
    const absolutePath = path.resolve(paths.root, artifact.path);
    const exists = fs.existsSync(absolutePath);
    const actualHash = exists ? createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex') : undefined;
    return { path: artifact.path, exists, valid: exists && actualHash === artifact.contentHash, expectedHash: artifact.contentHash, actualHash };
  });
  const valid = checks.length > 0 && checks.every((check) => check.valid);
  const result = { valid, manifestPath, contractId: (manifest as { contractId?: string }).contractId, checks };
  if (!valid) throw new CliError('CONFIG_INVALID', `Export manifest verification failed: ${checks.filter((check) => !check.valid).map((check) => path.basename(check.path)).join(', ')}`);
  if (opts.json) console.log(JSON.stringify(result, null, 2)); else console.log(`Artifact manifest valid: ${checks.length} file(s)`);
}

export async function runArtifactTemplate(opts: { kind: string; out?: string; json?: boolean }): Promise<void> {
  const kind = opts.kind as ArtifactKind;
  if (!ARTIFACT_KINDS.includes(kind)) {
    throw new CliError('CONFIG_INVALID', `Unknown artifact kind: ${opts.kind}. Supported kinds: ${ARTIFACT_KINDS.join(', ')}`);
  }

  let template: unknown;
  if (kind === 'semantic-ir') {
    template = {
      schemaVersion: '1.0',
      status: 'complete',
      document: { title: 'Specification Title', summary: 'System feature spec', language: ['en', 'vi', 'ja'], provenance: [] },
      sections: [{ id: 'sec-1', title: 'Main Section', order: 1, contentSummary: 'Section overview', confidence: 1, provenance: [] }],
      entities: [{ id: 'ent-model', name: 'FormModel', type: 'data-entity', description: 'Data entity', confidence: 1, attributes: [{ name: 'field1', type: 'string', required: true, description: 'Field description' }], provenance: [] }],
      flows: [{ id: 'flow-1', name: 'Submit Action', description: 'User submits data', confidence: 1, steps: [{ order: 1, action: 'User clicks button', target: 'btnSubmit', provenance: [] }], postconditions: ['Data saved'], provenance: [] }],
      rules: [{ id: 'rule-1', name: 'Validation Rule', statement: 'Field1 cannot be empty', type: 'validation', confidence: 1, provenance: [] }],
      relationships: [],
      unresolved: [],
    };
  } else if (kind === 'requirements') {
    template = {
      schemaVersion: '1.0',
      document: { title: 'Specification Requirements', summary: 'Functional and validation requirements', sourceSemanticIR: 'semantic-ir.json', provenance: [] },
      requirements: [{ id: 'REQ-001', title: 'Feature Execution', statement: 'System shall execute feature upon valid input', type: 'functional', sourceNature: 'explicit', inputs: [], dataNeeds: [], outcomes: [{ description: 'Executed', state: 'success', provenance: [] }], confidence: 1, relatedSemanticIds: [], preconditions: [{ description: 'Screen is open', provenance: [] }], expectedBehaviors: [{ description: 'Success response', provenance: [] }], constraints: [], testability: { status: 'testable', reasons: [] }, provenance: [] }],
      unresolved: [],
      conflicts: [],
      quality: { total: 1, explicit: 1, derived: 0, testable: 1, partiallyTestable: 0, notTestable: 0, unknownTestability: 0, lowConfidence: 0, unresolved: 0, conflicts: 0, provenanceCoverage: 1 },
    };
  } else if (kind === 'testcases') {
    template = [
      {
        id: 'TC-001',
        scenarioId: 'SC-001',
        requirementIds: ['REQ-001'],
        title: 'Happy path execution with valid inputs',
        objective: 'Verify system executes successfully under valid boundary conditions',
        type: 'ui',
        priority: 'high',
        confidence: 1,
        preconditions: [{ description: 'User is on target screen', sourceRequirementIds: ['REQ-001'] }],
        inputs: [{ name: 'inputField', value: 'valid-val', valueStrategy: 'valid' }],
        dataNeeds: [],
        steps: [{ order: 1, action: 'navigate to "/target"', target: '/target' }, { order: 2, action: 'type "valid-val" into "Field"', target: 'inputField', input: 'valid-val' }, { order: 3, action: 'click "Submit"', target: 'btnSubmit' }],
        expectedResults: [{ description: 'Success confirmation is displayed', verificationType: 'ui' }],
        cleanup: [{ description: 'Clean state', target: 'none' }],
        automation: { status: 'ready', suggestedExecutor: 'ui', reasons: [] },
        provenance: [{ requirementId: 'REQ-001', contextId: 'ctx-1' }],
      },
    ];
  } else if (kind === 'test-plan') {
    template = {
      schemaVersion: '1.0',
      scope: { requirementIds: ['REQ-001'], objective: 'Comprehensive test coverage across 11 behavior dimensions', assumptions: [], exclusions: [] },
      requirementCoverage: [{ requirementId: 'REQ-001', strategies: ['positive'], scenarioIds: ['SC-001'], status: 'covered', reasons: [] }],
      scenarios: [{ id: 'SC-001', title: 'Happy path scenario', objective: 'Verify normal operation', category: 'happy-path', priority: 'high', confidence: 1, requirementIds: ['REQ-001'], preconditions: [{ description: 'Screen open', sourceRequirementIds: ['REQ-001'] }], dataNeeds: [], expectedBehavior: ['Success display'], provenance: [{ requirementId: 'REQ-001', contextId: 'ctx-1' }] }],
      testCases: [],
      dataNeeds: [],
      quality: { requirementsTotal: 1, requirementsCovered: 1, requirementsPartiallyCovered: 0, requirementsNotCovered: 0, coverageRate: 1, scenarios: 1, testCases: 1, positiveCases: 1, negativeCases: 0, boundaryCases: 0, validationCases: 0, unresolved: 0, automationReady: 1, provenanceCoverage: 1 },
      unresolved: [],
    };
  } else {
    template = { schemaVersion: '1.0', contractId: 'contract-sample', contractVersion: 1, metadata: { contractFingerprint: 'pending', generatedAt: new Date().toISOString(), generatorVersion: '1.2.0' } };
  }

  const outputText = JSON.stringify(template, null, 2);
  if (opts.out) {
    fs.mkdirSync(path.dirname(opts.out), { recursive: true });
    fs.writeFileSync(opts.out, outputText, 'utf8');
    if (opts.json) console.log(JSON.stringify({ kind, path: opts.out }, null, 2)); else console.log(`Template for ${kind} written to: ${opts.out}`);
  } else {
    console.log(outputText);
  }
}
