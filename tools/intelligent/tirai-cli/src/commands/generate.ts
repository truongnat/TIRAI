// ---------------------------------------------------------------------------
// TIRAI — Generate Command (Phase 7: explicit white-box adapters)
// ---------------------------------------------------------------------------
// Per TIRAI v1 spec §9.2, §9.3: Playwright/Vitest are optional output adapters,
// not the default path. Generation requires explicit --target flag.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { requireWorkspace } from '../workspace.js';
import { loadConfig, validateConfigForGenerate } from '../config.js';
import { updateState, loadState } from '../state.js';
import { CliError } from '../errors.js';
import { resolveActiveTask, taskPaths, updateTask } from '../tasks.js';
import {
  generateE2ETests,
  generateUnitTests,
  validateGeneratedSource,
  validateGeneratedUnitSource,
} from 'test-code-generator';

export interface GenerateOptions {
  cwd: string;
  target?: 'playwright' | 'vitest';
  sourceMapping?: string;
  taskId?: string;
}

function readJson(p: string): unknown {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export async function runGenerate(opts: GenerateOptions): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  const task = opts.taskId ? resolveActiveTask(paths, opts.taskId) : undefined;
  if (opts.taskId && !task) throw new CliError('TASK_NOT_FOUND', `Task not found: ${opts.taskId}`);
  const taskWorkspace = task ? taskPaths(paths, task.id) : undefined;
  const runPaths = taskWorkspace ? { ...paths, artifactsDir: taskWorkspace.artifacts, testCasesPath: path.join(taskWorkspace.artifacts, 'testcases.json'), generatedE2eDir: path.join(taskWorkspace.generated, 'e2e'), generatedUnitDir: path.join(taskWorkspace.generated, 'unit') } : paths;
  const config = loadConfig(paths);
  validateConfigForGenerate(config);

  const state = loadState(paths);
  if (!state?.testPlan) {
    throw new CliError('CONFIG_INVALID', 'No TestCases found. Run `tirai plan` first.', 'Run `tirai plan` to generate canonical TestCases.');
  }

  // Load TestCases
  if (!fs.existsSync(runPaths.testCasesPath)) {
    throw new CliError('CONFIG_INVALID', 'TestCases artifact not found. Run `tirai plan` first.');
  }
  const testCases = readJson(runPaths.testCasesPath) as unknown[];
  const testCasesArray = Array.isArray(testCases) ? testCases : (testCases as { testCases: unknown[] }).testCases ?? [];
  if (!Array.isArray(testCasesArray) || testCasesArray.length === 0) {
    throw new CliError('CONFIG_INVALID', 'No TestCases available. Run `tirai plan` first.');
  }
  const tcs = testCasesArray as Array<Record<string, unknown>>;

  const target = opts.target;

  // --- Playwright E2E ---
  if (target === 'playwright') {
    if (!fs.existsSync(paths.e2eMappingPath)) {
      throw new CliError('MAPPING_MISSING', `E2E mapping not found: ${path.relative(paths.root, paths.e2eMappingPath)}`, 'Create a trusted E2E mapping at .tirai/mappings/e2e.json');
    }
    let e2eMappingRaw: unknown;
    try {
      e2eMappingRaw = readJson(paths.e2eMappingPath);
    } catch (e) {
      throw new CliError('MAPPING_MISSING', `Failed to read E2E mapping: ${String(e)}`);
    }
    const mapping = e2eMappingRaw as {
      testMappings: Array<{ testCaseId: string; status: string; ui?: unknown }>;
      unresolved: unknown[];
      catalogs: { uiCatalog?: unknown };
      quality: unknown;
    };

    if (!mapping.testMappings || mapping.testMappings.length === 0) {
      throw new CliError(
        'MAPPING_MISSING',
        `No E2E mapping entries for ${tcs.length} TestCases`,
        `Edit ${path.relative(paths.root, paths.e2eMappingPath)} to add mappings.`,
      );
    }

    const uiCatalog = (mapping.catalogs?.uiCatalog ?? undefined) as unknown;
    const profile = {
      ui: {
        environment: { baseUrl: config.e2e.baseUrl },
        catalog: uiCatalog,
      },
    } as unknown;

    const e2eOptions = {
      framework: 'playwright' as const,
      outputDir: runPaths.generatedE2eDir,
      baseUrl: config.e2e.baseUrl,
    };

    // Generation is a reproducible materialization step. Remove stale files
    // from a previous contract before writing the current set of cases.
    fs.rmSync(runPaths.generatedE2eDir, { recursive: true, force: true });
    fs.mkdirSync(runPaths.generatedE2eDir, { recursive: true });

    let e2eResult: unknown;
    try {
      const input = {
        testCases: tcs,
        mapping,
        profile,
        options: e2eOptions,
      } as unknown as Parameters<typeof generateE2ETests>[0];
      e2eResult = await generateE2ETests(input);
    } catch (e) {
      throw new CliError('GENERATION_BLOCKED', `E2E generation failed: ${String(e)}`);
    }

    const e2eRes = e2eResult as { status: string; metrics: { guessedMappings: number }; caseResults: Array<{ status: string; blockingReason?: unknown }> };
    if (e2eRes.status === 'blocked') {
      console.error(`BLOCKED: E2E generation blocked for all TestCases.`);
      for (const cr of e2eRes.caseResults) {
        if (cr.status === 'blocked') {
          console.error(`  ${(cr as unknown as { testCaseId: string }).testCaseId}: ${(cr.blockingReason as unknown as { message?: string })?.message ?? 'blocked'}`);
        }
      }
      throw new CliError('GENERATION_BLOCKED', 'E2E generation blocked (missing/untrusted mappings).');
    }

    const generatedFiles = (e2eResult as { generatedFiles: string[] }).generatedFiles;
    for (const file of generatedFiles) {
      const validation = await validateGeneratedSource(file, {});
      if (!validation.parseOk) {
        throw new CliError('VALIDATION_ERROR', `E2E validation failed for ${path.relative(paths.root, file)}: ${JSON.stringify(validation)}`);
      }
    }

    console.log(`E2E: ${generatedFiles.length} Playwright files generated`);
    if (task) updateTask(paths, task.id, { status: 'generated' });
    updateState(paths, (s) => ({
      ...s,
      generation: {
        at: new Date().toISOString(),
        e2eFiles: generatedFiles,
        unitFiles: s.generation?.unitFiles ?? [],
        generationAiCalls: 0,
        guessedMappings: 0,
        aiSymbolGuesses: 0,
      },
    }));
    return;
  }

  // --- Vitest Unit ---
  if (target === 'vitest') {
    // Vitest requires a real source mapping
    const mappingPath = opts.sourceMapping || paths.unitMappingPath;
    if (!fs.existsSync(mappingPath)) {
      throw new CliError(
        'MAPPING_MISSING',
        'Vitest generation requires a trusted source mapping.',
        'Provide --source-mapping <path> or create .tirai/mappings/unit.json',
      );
    }

    let unitRaw: unknown;
    try {
      unitRaw = readJson(mappingPath);
    } catch (e) {
      throw new CliError('MAPPING_MISSING', `Failed to read Unit mapping: ${String(e)}`);
    }
    let unitMappings: unknown[] = [];
    if (Array.isArray(unitRaw)) {
      unitMappings = unitRaw;
    } else if (unitRaw && typeof unitRaw === 'object' && 'mappings' in (unitRaw as Record<string, unknown>)) {
      const m = (unitRaw as Record<string, unknown>).mappings;
      if (Array.isArray(m)) unitMappings = m;
    }

    if (unitMappings.length === 0) {
      throw new CliError(
        'MAPPING_MISSING',
        'Vitest generation blocked: no source mappings provided.',
        'Add trusted UnitTargetCodeMapping entries to .tirai/mappings/unit.json',
      );
    }

    const unitProfile = {
      projectRoot: path.resolve(paths.root, config.unit.projectRoot),
      language: 'typescript',
      moduleSystem: 'esm',
      unitTestFramework: 'vitest',
      sourceRoots: ['.'],
      testRoots: ['.'],
      testCommand: 'npx vitest run',
    };

    fs.rmSync(runPaths.generatedUnitDir, { recursive: true, force: true });
    fs.mkdirSync(runPaths.generatedUnitDir, { recursive: true });

    const unitInput = {
      testCases: tcs,
      profile: unitProfile,
      targetMappings: unitMappings,
      framework: 'vitest',
      options: {
        framework: 'vitest' as const,
        outputDir: runPaths.generatedUnitDir,
      },
    } as unknown as Parameters<typeof generateUnitTests>[0];

    let unitResult: unknown;
    try {
      unitResult = await generateUnitTests(unitInput);
    } catch (e) {
      throw new CliError('GENERATION_BLOCKED', `Unit generation failed: ${String(e)}`);
    }

    const uRes = unitResult as { status: string; caseResults: Array<{ status: string; blockingReason?: { code?: string; message?: string } }>; metrics: { aiSymbolGuesses: number; staleMappingsDetected?: number } };
    const stale = uRes.caseResults.find((cr) => (cr.blockingReason as unknown as { code?: string })?.code === 'STALE_MAPPING' || (cr.blockingReason as unknown as { message?: string })?.message?.includes('STALE'));
    if (stale) {
      console.error(`BLOCKED: Unit mapping stale for ${(stale as unknown as { testCaseId: string }).testCaseId}`);
      throw new CliError('STALE_MAPPING', `Unit mapping stale: ${JSON.stringify(stale.blockingReason)}`, 'Regenerate mapping with current source fingerprint or update target source.');
    }
    if (uRes.status === 'blocked') {
      console.error(`BLOCKED: Unit generation blocked for all TestCases.`);
      for (const cr of uRes.caseResults) {
        if (cr.status === 'blocked') {
          console.error(`  ${(cr as unknown as { testCaseId: string }).testCaseId}: ${(cr.blockingReason as unknown as { message?: string })?.message ?? 'blocked'}`);
        }
      }
      throw new CliError('GENERATION_BLOCKED', 'Unit generation blocked (missing/untrusted mappings).');
    }

    const generatedFiles = (unitResult as { generatedFiles: string[] }).generatedFiles;
    for (const file of generatedFiles) {
      const v = validateGeneratedUnitSource(file, { resolveDir: path.dirname(file) });
      if ((v as unknown as { status: string }).status !== 'valid') {
        throw new CliError('VALIDATION_ERROR', `Unit validation failed for ${path.relative(paths.root, file)}: ${JSON.stringify(v)}`);
      }
    }

    console.log(`Unit: ${generatedFiles.length} Vitest files generated`);
    if (task) updateTask(paths, task.id, { status: 'generated' });
    updateState(paths, (s) => ({
      ...s,
      generation: {
        at: new Date().toISOString(),
        e2eFiles: s.generation?.e2eFiles ?? [],
        unitFiles: generatedFiles,
        generationAiCalls: 0,
        guessedMappings: 0,
        aiSymbolGuesses: 0,
      },
    }));
    return;
  }

  // No target specified — show help
  console.log('Usage: tirai generate --target playwright|vitest');
  console.log('');
  console.log('Options:');
  console.log('  --target playwright   Generate Playwright E2E tests (requires E2E mapping)');
  console.log('  --target vitest       Generate Vitest unit tests (requires source mapping)');
  console.log('  --source-mapping      Path to unit source mapping (for --target vitest)');
  throw new CliError('INVALID_TARGET', 'Missing --target. Use playwright or vitest.');
}
