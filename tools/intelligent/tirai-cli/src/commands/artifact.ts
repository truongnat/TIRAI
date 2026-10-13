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
        && (cleanup.target === undefined || hasText(cleanup.target)))
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
