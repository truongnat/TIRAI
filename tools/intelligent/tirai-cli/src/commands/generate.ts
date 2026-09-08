import * as fs from 'node:fs';
import * as path from 'node:path';
import { requireWorkspace } from '../workspace.js';
import { loadConfig, validateConfigForGenerate } from '../config.js';
import { updateState, loadState } from '../state.js';
import { CliError } from '../errors.js';
import {
  generateE2ETests,
  generateUnitTests,
  validateGeneratedSource,
  validateGeneratedUnitSource,
} from 'test-code-generator';

export interface GenerateOptions {
  cwd: string;
  e2e?: boolean;
  unit?: boolean;
}

function readJson(p: string): unknown {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export async function runGenerate(opts: GenerateOptions): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  const config = loadConfig(paths);
  validateConfigForGenerate(config);

  const state = loadState(paths);
  if (!state?.testPlan) {
    throw new CliError('CONFIG_INVALID', 'No TestCases found. Run `tirai ingest <spec>` first.', 'Run `tirai ingest` to generate canonical TestCases.');
  }

  // Load TestCases
  if (!fs.existsSync(paths.testCasesPath)) {
    throw new CliError('CONFIG_INVALID', 'TestCases artifact not found. Run `tirai ingest` first.');
  }
  const testCases = readJson(paths.testCasesPath) as unknown[];
  const testCasesArray = Array.isArray(testCases) ? testCases : (testCases as { testCases: unknown[] }).testCases ?? [];
  if (!Array.isArray(testCasesArray) || testCasesArray.length === 0) {
    throw new CliError('CONFIG_INVALID', 'No TestCases available. Run `tirai ingest` first.');
  }
  // Normalize to TestCase[]
  const tcs = testCasesArray as Array<Record<string, unknown>>;

  const explicitE2e = Boolean(opts.e2e);
  const explicitUnit = Boolean(opts.unit);
  const wantE2e = explicitE2e || (!explicitE2e && !explicitUnit);
  const wantUnit = explicitUnit || (!explicitE2e && !explicitUnit);

  let e2eResult: unknown = null;
  let unitResult: unknown = null;

  // --- E2E ---
  if (wantE2e) {
    if (!fs.existsSync(paths.e2eMappingPath)) {
      if (explicitE2e) {
        throw new CliError('MAPPING_MISSING', `E2E mapping not found: ${path.relative(paths.root, paths.e2eMappingPath)}`, 'Create a trusted E2E mapping at .tirai/mappings/e2e.json');
      }
      console.log('Skipping E2E: no mapping file.');
    } else {
    let e2eMappingRaw: unknown;
    try {
      e2eMappingRaw = readJson(paths.e2eMappingPath);
    } catch (e) {
      throw new CliError('MAPPING_MISSING', `Failed to read E2E mapping: ${String(e)}`);
    }
    // Support both { mappings: [...] } wrapper and direct mapping
    const e2eMapping: unknown = e2eMappingRaw;
    if (e2eMappingRaw && typeof e2eMappingRaw === 'object' && 'mappings' in (e2eMappingRaw as Record<string, unknown>)) {
      // unit wrapper mistaken
      throw new CliError('MAPPING_MISSING', 'E2E mapping file appears to contain unit mappings. Check .tirai/mappings/e2e.json');
    }
    // If file contains _comment + schemaVersion, it's direct
    // If file was placeholder with empty testMappings, it will be empty -> BLOCKED
    const mapping = e2eMapping as {
      testMappings: Array<{ testCaseId: string; status: string; ui?: unknown }>;
      unresolved: unknown[];
      catalogs: { uiCatalog?: unknown };
      quality: unknown;
    };

    if (!mapping.testMappings || mapping.testMappings.length === 0) {
      if (explicitE2e) {
        throw new CliError(
          'MAPPING_MISSING',
          `No E2E mapping entries for ${tcs.length} TestCases`,
          `Edit ${path.relative(paths.root, paths.e2eMappingPath)} or omit --e2e to generate unit tests from JSON.`,
        );
      }
      console.log('Skipping E2E: no trusted mappings (unit tests still generate from TestCase JSON).');
    } else {

    // Build profile
    const uiCatalog = (mapping.catalogs?.uiCatalog ?? undefined) as unknown;
    const profile = {
      ui: {
        environment: { baseUrl: config.e2e.baseUrl },
        catalog: uiCatalog,
      },
    } as unknown;

    const e2eOptions = {
      framework: 'playwright' as const,
      outputDir: paths.generatedE2eDir,
      baseUrl: config.e2e.baseUrl,
    };

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

    // Validation
    const generatedFiles = (e2eResult as { generatedFiles: string[] }).generatedFiles;
    for (const file of generatedFiles) {
      const validation = await validateGeneratedSource(file, {});
      if (!validation.parseOk) {
        throw new CliError('VALIDATION_ERROR', `E2E validation failed for ${path.relative(paths.root, file)}: ${JSON.stringify(validation)}`);
      }
    }

    // Persist metrics are inside result; no extra persistence needed (files already written to generatedE2eDir)
    console.log(`E2E: ${generatedFiles.length} Playwright files generated`);
    }
    }
  }

  // --- Unit ---
  if (wantUnit) {
    let unitRaw: unknown = { mappings: [] };
    if (fs.existsSync(paths.unitMappingPath)) {
      try {
        unitRaw = readJson(paths.unitMappingPath);
      } catch (e) {
        throw new CliError('MAPPING_MISSING', `Failed to read Unit mapping: ${String(e)}`);
      }
    }
    let unitMappings: unknown[] = [];
    if (Array.isArray(unitRaw)) {
      unitMappings = unitRaw;
    } else if (unitRaw && typeof unitRaw === 'object' && 'mappings' in (unitRaw as Record<string, unknown>)) {
      const m = (unitRaw as Record<string, unknown>).mappings;
      if (Array.isArray(m)) unitMappings = m;
    } else if (unitRaw && typeof unitRaw === 'object' && 'testCaseId' in (unitRaw as Record<string, unknown>)) {
      unitMappings = [unitRaw];
    } else {
      unitMappings = [];
    }

    if (unitMappings.length === 0) {
      console.log('Unit: no source mappings; generating spec preview artifacts (not tests) from TestCase JSON.');
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

    const unitInput = {
      testCases: tcs,
      profile: unitProfile,
      targetMappings: unitMappings,
      framework: 'vitest',
      options: {
        framework: 'vitest' as const,
        outputDir: paths.generatedUnitDir,
      },
    } as unknown as Parameters<typeof generateUnitTests>[0];

    try {
      unitResult = await generateUnitTests(unitInput);
    } catch (e) {
      throw new CliError('GENERATION_BLOCKED', `Unit generation failed: ${String(e)}`);
    }

    const uRes = unitResult as { status: string; caseResults: Array<{ status: string; blockingReason?: { code?: string; message?: string } }>; metrics: { aiSymbolGuesses: number; staleMappingsDetected?: number } };
    // Check for stale
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
  }

  // Update state
  const e2eMetrics = (e2eResult as { metrics?: { generationAiCalls: number; guessedMappings: number } } | null)?.metrics;
  const unitMetrics = (unitResult as { metrics?: { generationAiCalls: number; aiSymbolGuesses: number } } | null)?.metrics;
  updateState(paths, (s) => ({
    ...s,
    generation: {
      at: new Date().toISOString(),
      e2eFiles: (e2eResult as { generatedFiles?: string[] } | null)?.generatedFiles ?? s.generation?.e2eFiles ?? [],
      unitFiles: (unitResult as { generatedFiles?: string[] } | null)?.generatedFiles ?? s.generation?.unitFiles ?? [],
      generationAiCalls: (e2eMetrics?.generationAiCalls ?? 0) + (unitMetrics?.generationAiCalls ?? 0),
      guessedMappings: (e2eMetrics?.guessedMappings ?? 0),
      aiSymbolGuesses: (unitMetrics?.aiSymbolGuesses ?? 0),
    },
  }));

  console.log('TIRAI generate complete');
  // Gate checks: generationAiCalls, guessedMappings, aiSymbolGuesses are 0 (enforced by generators)
}
