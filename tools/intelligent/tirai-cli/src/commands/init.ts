import * as fs from 'node:fs';
import * as path from 'node:path';
import { getWorkspacePaths, ensureDir, atomicWriteJson, findWorkspace, WORKSPACE_VERSION } from '../workspace.js';
import { defaultConfig } from '../config.js';
import { CliError } from '../errors.js';
import { initState } from '../state.js';
import { detectProject } from '../utils/project-detect.js';

export interface InitOptions {
  cwd: string;
  force?: boolean;
}

export async function runInit(opts: InitOptions): Promise<void> {
  const projectRoot = path.resolve(opts.cwd);
  const existing = findWorkspace(projectRoot);
  const paths = getWorkspacePaths(projectRoot);
  const alreadyExists = fs.existsSync(paths.workspace);
  if (alreadyExists && !opts.force) {
    if (existing === projectRoot) {
      throw new CliError(
        'WORKSPACE_ALREADY_EXISTS',
        'TIRAI workspace already exists at .tirai/',
        'Remove .tirai/ or use --force to reinitialize.',
      );
    }
  }

  // Create workspace directories
  ensureDir(paths.workspace);
  ensureDir(paths.mappingsDir);
  ensureDir(path.join(paths.mappingsDir, 'e2e'));
  ensureDir(path.join(paths.mappingsDir, 'unit'));
  ensureDir(paths.artifactsDir);
  ensureDir(paths.generatedE2eDir);
  ensureDir(paths.generatedUnitDir);
  ensureDir(paths.runtimeE2eDir);
  ensureDir(paths.runtimeUnitDir);
  ensureDir(paths.resultsDir);
  ensureDir(paths.reportsDir);
  ensureDir(path.dirname(paths.statePath));
  ensureDir(paths.sourcesDir);
  // New directories for Phase 2
  ensureDir(paths.specsDir);
  ensureDir(paths.tasksDir);
  ensureDir(paths.outputsDir);
  ensureDir(paths.outputsJsonDir);
  ensureDir(paths.outputsExcelDir);
  ensureDir(paths.outputsPdfDir);
  ensureDir(paths.outputsDocxDir);
  ensureDir(paths.outputsMarkdownDir);

  // Detect project
  const detection = detectProject(projectRoot);

  // Build config
  const config = defaultConfig(projectRoot);
  config.project.defaultLanguage = detection.language || 'en';
  config.project.name = detection.projectName;
  config.project.type = detection.playwrightDetected ? 'web' : 'unknown';

  // Write config.json
  atomicWriteJson(paths.configPath, config);

  // Write project.json
  const projectJson = {
    version: 1,
    workspaceVersion: WORKSPACE_VERSION,
    project: {
      root: projectRoot,
      detection,
    },
    createdAt: new Date().toISOString(),
  };
  atomicWriteJson(paths.projectJsonPath, projectJson);

  // Create mappings placeholders if not exist
  if (!fs.existsSync(paths.e2eMappingPath)) {
    const e2ePlaceholder = {
      _comment: 'TIRAI E2E trusted mapping — human-readable, persisted, reusable',
      schemaVersion: '1.0',
      testMappings: [],
      unresolved: [],
      catalogs: { uiCatalog: { environmentId: detection.projectName ?? 'default', pages: [] } },
      quality: { testCasesTotal: 0, ready: 0, partial: 0, unresolved: 0 },
    };
    atomicWriteJson(paths.e2eMappingPath, e2ePlaceholder);
  }
  if (!fs.existsSync(paths.unitMappingPath)) {
    const unitPlaceholder = {
      _comment: 'TIRAI Unit trusted mappings — array of UnitTargetCodeMapping',
      mappings: [],
    };
    atomicWriteJson(paths.unitMappingPath, unitPlaceholder);
  }

  // Initialize state
  initState(paths);

  // Keep sanitized workflow outputs while excluding temporary credentials and raw logs.
  const gitignorePath = path.join(paths.workspace, '.gitignore');
  const workflowIgnoreMarker = '# TIRAI web-testing workflow artifacts';
  const workflowIgnoreRules = `${workflowIgnoreMarker}
!reports/
!reports/latest-summary.md
artifacts/ai/
artifacts/ai-input.json
workflow/runtime/
runtime/manual-session-*.json
runtime/*.log
runtime/**/*.log
runtime/raw-logs/
`;
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, `# TIRAI workspace — volatile results ignored, reviewed artifacts tracked
results/
reports/
artifacts/semantic-context/
*.log
${workflowIgnoreRules}`, 'utf8');
  } else {
    const currentIgnore = fs.readFileSync(gitignorePath, 'utf8');
    const currentLines = new Set(currentIgnore.split(/\r?\n/));
    const missingRules = workflowIgnoreRules.split(/\r?\n/).filter((line) => line && !currentLines.has(line));
    if (missingRules.length > 0) {
      fs.writeFileSync(gitignorePath, `${currentIgnore.trimEnd()}\n\n${missingRules.join('\n')}\n`, 'utf8');
    }
  }

  // Initialize specs index
  if (!fs.existsSync(paths.specsIndexPath)) {
    atomicWriteJson(paths.specsIndexPath, { specs: [] });
  }
  if (!fs.existsSync(paths.tasksIndexPath)) {
    atomicWriteJson(paths.tasksIndexPath, { schemaVersion: '1.0', tasks: [] });
  }

  console.log('TIRAI workspace initialized');
  console.log(`  Workspace: ${path.relative(projectRoot, paths.workspace)}/`);
  console.log(`  Config:    ${path.relative(projectRoot, paths.configPath)}`);
  console.log(`  Mappings:  ${path.relative(projectRoot, paths.mappingsDir)}/`);
  console.log(`  Outputs:   ${path.relative(projectRoot, paths.outputsDir)}/`);
  console.log(`  Specs:     ${path.relative(projectRoot, paths.specsDir)}/`);
  console.log(`  Project:   ${detection.projectName ?? path.basename(projectRoot)} (${detection.language}, ${detection.packageManager ?? 'unknown pm'})`);
  if (detection.playwrightDetected) console.log('  Playwright: detected');
  if (detection.vitestDetected) console.log('  Vitest: detected');
}
