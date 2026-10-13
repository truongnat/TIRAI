import * as fs from 'node:fs';
import * as path from 'node:path';
import { requireWorkspace, ensureDir } from '../workspace.js';
import { loadConfig } from '../config.js';
import { updateState } from '../state.js';
import { CliError } from '../errors.js';
import { runSourceToTestCasePipeline } from 'source-to-testcase';
import { buildSourceDerivedE2EMapping } from '../source-derived-mapping.js';
import { resolveActiveTask, taskPaths, updateTask } from '../tasks.js';

export interface IngestOptions {
  cwd: string;
  sourcePath: string;
  sourceCodePath?: string;
  json?: boolean;
  taskId?: string;
}

export async function runIngest(opts: IngestOptions): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  loadConfig(paths);

  const task = opts.taskId ? resolveActiveTask(paths, opts.taskId) : undefined;
  if (opts.taskId && !task) throw new CliError('TASK_NOT_FOUND', `Task not found: ${opts.taskId}`);
  const outputDir = task ? taskPaths(paths, task.id).artifacts : paths.artifactsDir;
  if (task) updateTask(paths, task.id, { status: 'ingesting' });

  if (!opts.sourcePath) {
    throw new CliError('SOURCE_INPUT_ERROR', 'Missing source path. Usage: tirai ingest <spec.xlsx|spec.md|spec.html>', 'Provide a local Excel, Markdown, or HTML specification file.');
  }

  // Handle URL vs file path
  const isUrlSource = (() => {
    try {
      const u = new URL(opts.sourcePath);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  })();
  const absSource = isUrlSource ? opts.sourcePath : path.resolve(opts.cwd, opts.sourcePath);
  if (!isUrlSource && !fs.existsSync(absSource)) {
    throw new CliError('SOURCE_NOT_FOUND', `Source not found: ${opts.sourcePath}`);
  }

  const sourceStat = isUrlSource ? { size: Buffer.byteLength(absSource, 'utf8') } as fs.Stats : fs.statSync(absSource);


  // Auto-detect sourceKind from extension or URL (so PDF/DOCX/CSV/JSON/URL work without explicit config)
  let sourceKind: string | undefined;
  const isUrl = (() => {
    try {
      const u = new URL(absSource);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  })();
  if (isUrl) {
    sourceKind = 'url';
  } else {
    const ext = path.extname(absSource).toLowerCase();
    if (ext === '.pdf') sourceKind = 'pdf';
    else if (ext === '.docx') sourceKind = 'docx';
    else if (ext === '.csv') sourceKind = 'csv';
    else if (ext === '.json') sourceKind = 'json';
    else if (ext === '.md' || ext === '.markdown') sourceKind = 'markdown';
    else if (ext === '.html' || ext === '.htm') sourceKind = 'html';
    else if (ext === '.xlsx' || ext === '.xlsm') sourceKind = 'excel';
  }

  let result;
  try {
    result = await runSourceToTestCasePipeline({
      sourcePath: absSource,
      sourceCodePath: opts.sourceCodePath ? path.resolve(opts.cwd, opts.sourceCodePath) : undefined,
      outputDir,
      ...(sourceKind ? { sourceKind } : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Map pipeline errors to source/pipeline error taxonomy
    if (msg.includes('SOURCE_INGESTION')) {
      throw new CliError('SOURCE_INPUT_ERROR', msg);
    }
    throw new CliError('PIPELINE_ERROR', `Ingest failed: ${msg}`);
  }
  // The pipeline either compiled a structured-design document into the full
  // canonical artifact set (contract.json present) or produced only raw
  // artifacts for a host agent to complete. Detect via the contract file.
  const contractPath = result.artifacts.contract as string | undefined;
  const contractReady = typeof contractPath === 'string' && fs.existsSync(contractPath);
  if (task) {
    updateTask(paths, task.id, contractReady
      ? { status: 'contract-ready', contractPath: path.relative(paths.root, contractPath), artifactManifestPath: result.artifacts.aiRun }
      : { status: 'analyzed' });
  }

  if (!contractReady && opts.sourceCodePath) {
    throw new CliError(
      'MAPPING_MISSING',
      'Source-derived E2E mapping requires canonical test cases; the ingest produced only raw artifacts.',
      'Have the host agent write and import semantic-ir, requirements, test-plan, testcases, and contract via `tirai artifact import`, then re-run with --source-code.',
    );
  }

  // Source inspection is an explicit opt-in. The normal specification-first path
  // does not read the application source tree.
  let mappingNotice = '\nE2E mapping: not generated (source inspection was not enabled)';
  if (opts.sourceCodePath) {
    if (!result.testPlanIR) {
      throw new CliError('MAPPING_MISSING', 'Source-derived mapping requires the canonical test plan; re-run after importing host-agent artifacts.');
    }
    try {
      const sourceCodeRoot = path.resolve(opts.cwd, opts.sourceCodePath);
      const sourceMapping = buildSourceDerivedE2EMapping(sourceCodeRoot, result.testPlanIR.testCases);
      if (sourceMapping) {
        ensureDir(paths.mappingsDir);
        fs.writeFileSync(paths.e2eMappingPath, JSON.stringify(sourceMapping.mapping, null, 2), 'utf8');
        const mappingData = sourceMapping.mapping as { testMappings: unknown[]; unresolved: unknown[] };
        fs.writeFileSync(path.join(paths.artifactsDir, 'source-intelligence.json'), JSON.stringify({ schemaVersion: '1.0', sourceFiles: sourceMapping.sourceFiles, mappingCount: mappingData.testMappings.length, unresolvedCount: mappingData.unresolved.length, generatedAt: new Date().toISOString() }, null, 2), 'utf8');
        mappingNotice = `\nE2E mapping: ${path.relative(paths.root, paths.e2eMappingPath)} (${sourceMapping.sourceFiles.length} source files scanned)`;
      }
    } catch (error) {
      throw new CliError('MAPPING_MISSING', `Source-derived mapping failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Update workspace state
  updateState(paths, (s) => {
    const next = {
      ...s,
      source: {
        path: absSource,
        contentHash: result.source.contentHash,
        byteLength: sourceStat.size,
        ingestedAt: new Date().toISOString(),
        artifactCount: result.source.artifactCount,
        contextCount: result.source.contextCount,
      },
    };
    if (contractReady) {
      next.testPlan = {
        requirementCount: result.requirements.requirementCount,
        scenarioCount: result.testPlan.scenarioCount,
        testCaseCount: result.testPlan.testCaseCount,
        ingestedAt: new Date().toISOString(),
      };
    }
    return next;
  });

  // Copy source into workspace sources for reproducibility (skip for URL, just record)
  if (!isUrlSource) {
    ensureDir(paths.sourcesDir);
    const destSource = path.join(paths.sourcesDir, path.basename(absSource));
    fs.copyFileSync(absSource, destSource);
  } else {
    ensureDir(paths.sourcesDir);
    // For URL, just record the URL string
    fs.writeFileSync(path.join(paths.sourcesDir, 'url-source.txt'), absSource, 'utf8');
  }

  // Also ensure .tirai/sources is not secret-leaking (source is spec, not secret)

  if (opts.json) {
    console.log(JSON.stringify({
      source: result.source,
      status: contractReady ? 'contract-ready' : 'awaiting-agent',
      requirements: result.requirements.requirementCount,
      scenarios: result.testPlan.scenarioCount,
      testCases: result.testPlan.testCaseCount,
      artifacts: result.artifacts,
    }, null, 2));
  } else {
    console.log('TIRAI ingest complete');
    console.log('');
    console.log(`Source:`);
    console.log(`  ${opts.sourcePath}`);
    console.log('');
    console.log(`Artifacts:`);
    console.log(`  ${path.relative(paths.root, outputDir)}/`);
    if (contractReady) {
      console.log('');
      console.log(`Requirements:`);
      console.log(`  ${result.requirements.requirementCount}`);
      console.log('');
      console.log(`Scenarios:`);
      console.log(`  ${result.testPlan.scenarioCount}`);
      console.log('');
      console.log(`TestCases:`);
      console.log(`  ${result.testPlan.testCaseCount}`);
      if (mappingNotice) console.log(mappingNotice);
    } else {
      console.log('');
      console.log('Status: awaiting-agent — raw ingest artifacts were produced; no canonical contract exists yet.');
      console.log('Next steps for the host agent:');
      console.log(`  1. Read the semantic input at ${path.relative(paths.root, result.artifacts.aiInput)}`);
      console.log('  2. Produce semantic-ir.json, requirements.json, test-plan.json, testcases.json, and contract.json.');
      console.log('  3. Import each artifact with `tirai artifact import <kind> --file <path>`');
      console.log('     (kinds: semantic-ir | requirements | test-plan | testcases | contract).');
    }
  }
}

