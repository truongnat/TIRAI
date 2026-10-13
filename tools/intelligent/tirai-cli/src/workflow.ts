import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { TestCase } from 'test-execution-orchestrator';
import type { WorkspacePaths } from './workspace.js';
import { CliError } from './errors.js';

export interface CaseApproval {
  testCaseId: string;
  fingerprint: string;
  route: string;
  reviewer: string;
  approvedAt: string;
  specFingerprint: string | null;
}

export interface ApprovalStore {
  schemaVersion: '1.0';
  approvals: CaseApproval[];
}

export interface WorkflowPaths {
  directory: string;
  approvals: string;
  clarifications: string;
  discovery: string;
  runs: string;
  runtime: string;
}

export function getWorkflowPaths(paths: WorkspacePaths): WorkflowPaths {
  const directory = path.join(paths.workspace, 'workflow');
  return {
    directory,
    approvals: path.join(directory, 'approvals.json'),
    clarifications: path.join(directory, 'clarifications.json'),
    discovery: path.join(paths.workspace, 'discovery', 'routes.json'),
    runs: path.join(directory, 'runs'),
    runtime: path.join(directory, 'runtime'),
  };
}

export function ensurePrivateWorkspaceArtifactsIgnored(paths: WorkspacePaths): void {
  const ignorePath = path.join(paths.workspace, '.gitignore');
  const current = fs.existsSync(ignorePath) ? fs.readFileSync(ignorePath, 'utf8') : '';
  const marker = '# TIRAI web-testing workflow artifacts';
  const requiredRules = ['artifacts/ai-input.json', 'workflow/runtime/'];
  const currentLines = current.split(/\r?\n/);
  const hasMarker = currentLines.includes(marker);
  const rulesAreLast = current.trimEnd().endsWith(requiredRules.join('\n'));
  if (hasMarker && rulesAreLast) return;
  const additions = [...(hasMarker ? [] : [marker]), ...requiredRules];
  fs.writeFileSync(ignorePath, `${current.trimEnd()}${current.trimEnd() ? '\n\n' : ''}${additions.join('\n')}\n`, 'utf8');
}
export function getManualSessionPath(runtimeDir: string, environment: string): string {
  return path.join(runtimeDir, `manual-session-${safeEnvironmentName(environment)}.json`);
}
export function getImportedSessionPath(runtimeDir: string, environment: string): string {
  return path.join(runtimeDir, `imported-session-${safeEnvironmentName(environment)}.json`);
}

export interface ActiveWebSession {
  path: string;
  consumeAfterExecution: boolean;
}

export function getActiveWebSession(runtimeDir: string, environment: string): ActiveWebSession | null {
  const manualPath = getManualSessionPath(runtimeDir, environment);
  const importedPath = getImportedSessionPath(runtimeDir, environment);
  const hasManual = fs.existsSync(manualPath);
  const hasImported = fs.existsSync(importedPath);
  if (hasManual && hasImported) {
    throw new CliError('CONFIG_INVALID', `Both temporary and imported browser sessions exist for ${environment}. Run "tirai auth clear --environment ${environment}" first.`);
  }
  if (hasImported) return { path: importedPath, consumeAfterExecution: false };
  if (hasManual) return { path: manualPath, consumeAfterExecution: true };
  return null;
}

export function loadTestCases(filePath: string): TestCase[] {
  if (!fs.existsSync(filePath)) {
    throw new CliError('CONFIG_INVALID', 'No test cases found. Run "tirai plan" first.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new CliError('CONFIG_INVALID', `Test cases are not valid JSON: ${String(error)}`);
  }
  const cases = Array.isArray(parsed)
    ? parsed
    : (parsed as { testCases?: unknown[] } | null)?.testCases;
  if (!Array.isArray(cases)) {
    throw new CliError('CONFIG_INVALID', 'Canonical test cases must be an array or contain a testCases array.');
  }
  if (cases.some((testCase) => !hasTestCaseId(testCase))) {
    throw new CliError('CONFIG_INVALID', 'Every canonical test case must have a non-empty string ID.');
  }
  return cases as TestCase[];
}
function hasTestCaseId(value: unknown): value is { id: string } {
  if (typeof value !== 'object' || value === null || !('id' in value)) return false;
  return typeof value.id === 'string' && value.id.length > 0;
}

export function caseFingerprint(testCase: TestCase): string {
  // Approval binds to the executable content of a case only; cosmetic fields
  // (title, objective, priority, confidence, provenance, scenarioId) do not
  // change what runs, so editing them must not invalidate an approval.
  // Unknown new fields ARE included: anything not explicitly cosmetic stays in
  // the hash (fail-closed).
  const COSMETIC_FIELDS = new Set(['title', 'objective', 'priority', 'confidence', 'provenance', 'scenarioId']);
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (typeof value === 'object' && value !== null) {
      const record = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(record).sort()) {
        if (COSMETIC_FIELDS.has(key)) continue;
        out[key] = strip(record[key]);
      }
      return out;
    }
    return value;
  };
  return createHash('sha256').update(JSON.stringify(strip(testCase))).digest('hex');
}

const SECRET_FIELD_NAME = /password|passcode|username|user.?name|login|secret|token|credential|cookie|authorization|api.?key/i;

export function assertSecretReferences(testCase: TestCase): void {
  const literalInput = testCase.inputs.some((input) => SECRET_FIELD_NAME.test(input.name)
    && input.value !== undefined
    && !(typeof input.value === 'string' && input.value.startsWith('secret://')));
  const unsafeCredentialStep = testCase.steps.some((step) => {
    const label = `${step.action} ${step.target ?? ''}`;
    const referencesSecret = typeof step.input === 'string' && step.input.startsWith('secret://');
    const entersCredential = /\b(enter|type|fill|provide|use)\b/i.test(step.action);
    return SECRET_FIELD_NAME.test(label) && !referencesSecret && (Boolean(step.input) || entersCredential);
  });
  if (literalInput || unsafeCredentialStep) {
    throw new CliError('INVALID_TARGET', `Case ${testCase.id} contains a literal credential value. Use a configured secret://env:NAME reference instead.`);
  }
}

export function readApprovalStore(filePath: string): ApprovalStore {
  if (!fs.existsSync(filePath)) return { schemaVersion: '1.0', approvals: [] };
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<ApprovalStore>;
    if (value.schemaVersion !== '1.0' || !Array.isArray(value.approvals)
      || value.approvals.some((approval) => !approval
        || typeof approval.testCaseId !== 'string'
        || typeof approval.fingerprint !== 'string'
        || typeof approval.route !== 'string'
        || typeof approval.reviewer !== 'string'
        || typeof approval.approvedAt !== 'string'
        || (approval.specFingerprint !== null && typeof approval.specFingerprint !== 'string'))) {
      throw new Error('Invalid approval store shape.');
    }
    return value as ApprovalStore;
  } catch (error) {
    throw new CliError('CONFIG_INVALID', `Approval store is invalid: ${String(error)}`);
  }
}

export function saveApprovalStore(filePath: string, store: ApprovalStore): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

export function specFingerprint(paths: WorkspacePaths): string | null {
  const contractPath = path.join(paths.artifactsDir, 'contract.json');
  if (!fs.existsSync(contractPath)) return null;
  try {
    const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8')) as { metadata?: { contractFingerprint?: string } };
    return contract.metadata?.contractFingerprint ?? null;
  } catch {
    return null;
  }
}

export function safeEnvironmentName(environment: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(environment)) {
    throw new CliError('INVALID_TARGET', 'Environment names may contain only letters, numbers, underscores, and hyphens.');
  }
  return environment;
}

export function resolveApprovedRoute(baseUrl: string, route: string): string {
  if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//')) {
    throw new CliError('INVALID_TARGET', 'Approved route must be a same-origin absolute path beginning with one slash.');
  }
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new CliError('INVALID_TARGET', 'Configured web base URL is invalid.');
  }
  const resolved = new URL(route, base);
  if (resolved.origin !== base.origin || resolved.username || resolved.password) {
    throw new CliError('INVALID_TARGET', 'Approved route must stay on the configured application origin.');
  }
  if (resolved.search || resolved.hash) {
    throw new CliError('INVALID_TARGET', 'Approved web routes cannot include query parameters or fragments.');
  }
  return `${resolved.origin}${resolved.pathname}`;
}
export function assertNonProductionEnvironment(environment: string, baseUrl: string): void {
  if (!['local', 'dev', 'development', 'staging'].includes(environment.toLowerCase())) {
    throw new CliError('INVALID_TARGET', `Web automation is restricted to local/dev/staging environments; received "${environment}".`);
  }
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new CliError('INVALID_TARGET', 'Configured web base URL is invalid.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new CliError('INVALID_TARGET', 'Web base URL must be an HTTP(S) URL without embedded credentials.');
  }
  if (url.hostname.split('.').some((label) => /(^|[-_])(prod|production|live)([-_]|$)/i.test(label))) {
    throw new CliError('INVALID_TARGET', 'Web automation refuses production-like hostnames, even when the environment is labelled staging.');
  }
  if (environment.toLowerCase() === 'local') {
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
      throw new CliError('INVALID_TARGET', 'The local environment must target localhost or 127.0.0.1.');
    }
  }
}
