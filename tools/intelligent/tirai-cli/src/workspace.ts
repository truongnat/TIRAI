import * as fs from 'node:fs';
import * as path from 'node:path';
import { CliError } from './errors.js';

export const WORKSPACE_VERSION = 1;
export const CONFIG_VERSION = 2;

export interface WorkspacePaths {
  root: string;
  workspace: string;
  configPath: string;
  projectJsonPath: string;
  statePath: string;
  mappingsDir: string;
  e2eMappingPath: string;
  unitMappingPath: string;
  artifactsDir: string;
  contextPath: string;
  semanticIrPath: string;
  requirementsPath: string;
  testPlanPath: string;
  testCasesPath: string;
  tracePath: string;
  semanticContextDir: string;
  generatedDir: string;
  generatedE2eDir: string;
  generatedUnitDir: string;
  runtimeDir: string;
  runtimeE2eDir: string;
  runtimeUnitDir: string;
  resultsDir: string;
  e2eResultPath: string;
  unitResultPath: string;
  reportsDir: string;
  latestReportPath: string;
  sourcesDir: string;
  // New paths for Phase 2
  specsDir: string;
  specsIndexPath: string;
  outputsDir: string;
  outputsJsonDir: string;
  outputsExcelDir: string;
  outputsPdfDir: string;
  outputsDocxDir: string;
  outputsMarkdownDir: string;
}

export function findWorkspace(startDir: string): string | null {
  let dir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(dir, '.tirai');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function getWorkspacePaths(projectRoot: string): WorkspacePaths {
  const root = path.resolve(projectRoot);
  const workspace = path.join(root, '.tirai');
  return {
    root,
    workspace,
    configPath: path.join(workspace, 'config.json'),
    projectJsonPath: path.join(workspace, 'project.json'),
    statePath: path.join(workspace, 'state', 'workspace.json'),
    mappingsDir: path.join(workspace, 'mappings'),
    e2eMappingPath: path.join(workspace, 'mappings', 'e2e.json'),
    unitMappingPath: path.join(workspace, 'mappings', 'unit.json'),
    artifactsDir: path.join(workspace, 'artifacts'),
    contextPath: path.join(workspace, 'artifacts', 'context.json'),
    semanticIrPath: path.join(workspace, 'artifacts', 'semantic-ir.json'),
    requirementsPath: path.join(workspace, 'artifacts', 'requirements.json'),
    testPlanPath: path.join(workspace, 'artifacts', 'test-plan.json'),
    testCasesPath: path.join(workspace, 'artifacts', 'testcases.json'),
    tracePath: path.join(workspace, 'artifacts', 'trace.json'),
    semanticContextDir: path.join(workspace, 'artifacts', 'semantic-context'),
    generatedDir: path.join(workspace, 'generated'),
    generatedE2eDir: path.join(workspace, 'generated', 'e2e'),
    generatedUnitDir: path.join(workspace, 'generated', 'unit'),
    runtimeDir: path.join(workspace, 'runtime'),
    runtimeE2eDir: path.join(workspace, 'runtime', 'e2e'),
    runtimeUnitDir: path.join(workspace, 'runtime', 'unit'),
    resultsDir: path.join(workspace, 'results'),
    e2eResultPath: path.join(workspace, 'results', 'e2e-run-result-ir.json'),
    unitResultPath: path.join(workspace, 'results', 'unit-run-result-ir.json'),
    reportsDir: path.join(workspace, 'reports'),
    latestReportPath: path.join(workspace, 'reports', 'latest-summary.md'),
    sourcesDir: path.join(workspace, 'sources'),
    specsDir: path.join(workspace, 'specs'),
    specsIndexPath: path.join(workspace, 'specs', 'index.json'),
    outputsDir: path.join(workspace, 'outputs'),
    outputsJsonDir: path.join(workspace, 'outputs', 'json'),
    outputsExcelDir: path.join(workspace, 'outputs', 'excel'),
    outputsPdfDir: path.join(workspace, 'outputs', 'pdf'),
    outputsDocxDir: path.join(workspace, 'outputs', 'docx'),
    outputsMarkdownDir: path.join(workspace, 'outputs', 'markdown'),
  };
}

export function requireWorkspace(cwd: string): WorkspacePaths {
  const root = findWorkspace(cwd);
  if (!root) {
    throw new CliError(
      'WORKSPACE_NOT_FOUND',
      'TIRAI workspace not found. Run `tirai init` first.',
      'Run `tirai init` in your project root to create .tirai/',
    );
  }
  return getWorkspacePaths(root);
}

export function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

export function atomicWriteJson(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

export function readJsonIfExists<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}
