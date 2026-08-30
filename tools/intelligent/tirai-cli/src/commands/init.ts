import * as fs from 'node:fs';
import * as path from 'node:path';
import { getWorkspacePaths, ensureDir, atomicWriteJson, findWorkspace, WORKSPACE_VERSION } from '../workspace.js';
import { defaultConfig } from '../config.js';
import { CliError } from '../errors.js';
import { initState } from '../state.js';
import { detectProject } from '../utils/project-detect.js';
import { JsonProjectAdapter } from 'project-adapter';

export interface InitOptions {
  cwd: string;
  force?: boolean;
}

export async function runInit(opts: InitOptions): Promise<void> {
  const projectRoot = path.resolve(opts.cwd);
  const existing = findWorkspace(projectRoot);
  // Allow init if workspace exists at same root and --force, but default: if already initialized at this root, error
  const paths = getWorkspacePaths(projectRoot);
  const alreadyExists = fs.existsSync(paths.workspace);
  if (alreadyExists && !opts.force) {
    // If workspace found at projectRoot, block. If found at ancestor but not here, allow.
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

  // Detect project (reuse project-adapter where possible)
  const detection = detectProject(projectRoot);

  // Build config
  const config = defaultConfig(projectRoot);
  // Apply detected project info
  config.project.language = detection.language;
  if (detection.packageManager) config.project.packageManager = detection.packageManager;
  // Reuse project-adapter: if tirai.project.json exists, load via adapter and extract baseUrl/fingerprint
  let adapterFingerprint: string | undefined;
  let adapterProfile: unknown = null;
  const adapterConfigPath = path.join(projectRoot, 'tirai.project.json');
  if (fs.existsSync(adapterConfigPath)) {
    try {
      const adapter = new JsonProjectAdapter();
      const source = { projectRoot, configPath: adapterConfigPath, environment: 'local' };
      const canLoad = await adapter.canLoad(source);
      if (canLoad.supported) {
        const profile = await adapter.load(source, { environment: 'local' });
        adapterProfile = profile;
        adapterFingerprint = (profile as { fingerprint?: string }).fingerprint;
        const baseUrl = (profile as { environment?: { baseUrl?: string } }).environment?.baseUrl || (profile as { ui?: { environment?: { baseUrl?: string } } }).ui?.environment?.baseUrl;
        if (typeof baseUrl === 'string' && baseUrl.length > 0) {
          config.e2e.baseUrl = baseUrl;
        }
      } else {
        // fallback to manual parse
        const adapterRaw = JSON.parse(fs.readFileSync(adapterConfigPath, 'utf8'));
        const baseUrl = adapterRaw?.ui?.baseUrl ?? adapterRaw?.environments?.local?.baseUrl;
        if (typeof baseUrl === 'string' && baseUrl.length > 0) {
          config.e2e.baseUrl = baseUrl;
        }
      }
    } catch {
      // ignore adapter errors, keep defaults
    }
  } else {
    // No tirai.project.json — create a minimal one so project-adapter is demonstrably reused on next run
    const minimalAdapterConfig = {
      schemaVersion: '1.0',
      project: { id: detection.projectName ?? path.basename(projectRoot), name: detection.projectName ?? path.basename(projectRoot) },
      environments: {
        local: { name: 'local', safety: 'isolated', baseUrl: config.e2e.baseUrl },
      },
      ui: { baseUrl: config.e2e.baseUrl },
    };
    try {
      // Only write if not exists and we are not in a test tmp that already has one
      fs.writeFileSync(adapterConfigPath, JSON.stringify(minimalAdapterConfig, null, 2), 'utf8');
      // Load it via adapter to get fingerprint
      const adapter = new JsonProjectAdapter();
      const profile = await adapter.load({ projectRoot, configPath: adapterConfigPath, environment: 'local' }, { environment: 'local' });
      adapterProfile = profile;
      adapterFingerprint = (profile as { fingerprint?: string }).fingerprint;
    } catch {
      // ignore
    }
  }

  // Write config.json (versioned)
  atomicWriteJson(paths.configPath, config);

  // Write project.json (includes adapter reuse)
  const projectJson = {
    version: 1,
    workspaceVersion: WORKSPACE_VERSION,
    project: {
      root: projectRoot,
      detection,
      adapterFingerprint,
      adapterProfile: adapterProfile ? { projectId: (adapterProfile as { project?: { id?: string } }).project?.id, fingerprint: adapterFingerprint } : undefined,
    },
    createdAt: new Date().toISOString(),
  };
  atomicWriteJson(paths.projectJsonPath, projectJson);

  // Create mappings placeholders if not exist
  if (!fs.existsSync(paths.e2eMappingPath)) {
    const e2ePlaceholder = {
      _comment: 'TIRAI E2E trusted mapping — human-readable, persisted, reusable',
      // Example structure: see docs/quickstart.md
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

  // Safe .gitignore for volatile workspace content (do not ignore config/mappings/generated/runtime)
  // NOTE: runtime/ must NOT be ignored, otherwise Playwright (which respects .gitignore) will not discover tests.
  // We only ignore results/reports which are volatile outputs, not executable sources.
  const gitignorePath = path.join(paths.workspace, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    const gitignoreContent = `# TIRAI workspace — volatile results ignored, config/mappings/generated/runtime are tracked/executable
results/
reports/
artifacts/semantic-context/
*.log
`;
    fs.writeFileSync(gitignorePath, gitignoreContent, 'utf8');
  }

  // Also ensure .tirai itself is not ignored at repo root unless user wants; we suggest ignoring volatile subdirs only.
  // Do not modify root .gitignore automatically.

  console.log('TIRAI workspace initialized');
  console.log(`  Workspace: ${path.relative(projectRoot, paths.workspace)}/`);
  console.log(`  Config:    ${path.relative(projectRoot, paths.configPath)}`);
  console.log(`  Mappings:  ${path.relative(projectRoot, paths.mappingsDir)}/`);
  console.log(`  Project:   ${detection.projectName ?? path.basename(projectRoot)} (${detection.language}, ${detection.packageManager ?? 'unknown pm'})`);
  if (detection.playwrightDetected) console.log('  Playwright: detected');
  if (detection.vitestDetected) console.log('  Vitest: detected');
}
