// Artifact loader — loads and validates input artifacts from files.
//
// Loads ProjectExecutionProfile, Test Cases, Execution Mappings,
// Test Data Plan, and Executable Data Preparation IR from explicit paths.
// Does NOT search random directories (spec §17).

import { readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import type {
  EndToEndRunnerInput,
  ProjectExecutionProfile,
  ExecutionMappingIR,
  TestDataPlanIR,
  ExecutableDataPreparationIR,
  TestCase,
} from './models.js';
import { EndToEndRunnerError } from './errors.js';

// ---- Path safety (spec §53) -----------------------------------------------

export function assertWithinRoot(filePath: string, root: string): void {
  const resolved = isAbsolute(filePath) ? filePath : resolve(root, filePath);
  const rel = relative(root, resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new EndToEndRunnerError('RUNNER_PATH_ESCAPE', `Path escapes root: ${filePath}`, filePath);
  }
}

// ---- Safe file read -------------------------------------------------------

async function safeReadJson<T>(filePath: string, root?: string): Promise<T> {
  if (root) assertWithinRoot(filePath, root);
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    throw new EndToEndRunnerError('RUNNER_INPUT_MISSING', `Cannot read file: ${filePath}`, filePath);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new EndToEndRunnerError('RUNNER_INPUT_INVALID', `Not valid JSON: ${filePath}`, filePath);
  }
}

// ---- Schema version check (spec §18) --------------------------------------

function checkSchemaVersion(obj: Record<string, unknown>, path: string): void {
  const sv = obj['schemaVersion'];
  if (typeof sv !== 'string' || !sv.startsWith('1.')) {
    throw new EndToEndRunnerError(
      'RUNNER_SCHEMA_UNSUPPORTED',
      `Unsupported schema version: ${String(sv)}`,
      path,
    );
  }
}

// ---- Load individual artifacts --------------------------------------------

export async function loadProfile(filePath: string, root?: string): Promise<ProjectExecutionProfile> {
  const profile = await safeReadJson<ProjectExecutionProfile>(filePath, root);
  checkSchemaVersion(profile as unknown as Record<string, unknown>, filePath);
  if (!profile.project?.id) {
    throw new EndToEndRunnerError('RUNNER_INPUT_INVALID', 'Profile missing project.id', filePath);
  }
  return profile;
}

export async function loadTestCases(filePath: string, root?: string): Promise<TestCase[]> {
  const data = await safeReadJson<Record<string, unknown>>(filePath, root);
  checkSchemaVersion(data, filePath);
  const cases = data['testCases'];
  if (!Array.isArray(cases)) {
    throw new EndToEndRunnerError('RUNNER_INPUT_INVALID', 'Missing testCases array', filePath);
  }
  return cases as TestCase[];
}

export async function loadMappings(filePath: string, root?: string): Promise<ExecutionMappingIR> {
  const data = await safeReadJson<ExecutionMappingIR>(filePath, root);
  checkSchemaVersion(data as unknown as Record<string, unknown>, filePath);
  if (!Array.isArray(data.testMappings)) {
    throw new EndToEndRunnerError('RUNNER_INPUT_INVALID', 'Missing testMappings array', filePath);
  }
  return data;
}

export async function loadDataPlan(filePath: string, root?: string): Promise<TestDataPlanIR> {
  const data = await safeReadJson<TestDataPlanIR>(filePath, root);
  checkSchemaVersion(data as unknown as Record<string, unknown>, filePath);
  return data;
}

export async function loadPreparedData(filePath: string, root?: string): Promise<ExecutableDataPreparationIR> {
  const data = await safeReadJson<ExecutableDataPreparationIR>(filePath, root);
  checkSchemaVersion(data as unknown as Record<string, unknown>, filePath);
  return data;
}

// ---- Load all inputs (spec §17, §85-86) -----------------------------------

export interface LoadInputOptions {
  profilePath?: string;
  testCasesPath: string;
  mappingsPath: string;
  dataPlanPath?: string;
  preparedDataPath?: string;
  projectRoot?: string;
  projectDir?: string;
  environment?: string;
}

export async function loadAllInputs(opts: LoadInputOptions): Promise<EndToEndRunnerInput> {
  const root = opts.projectRoot;

  if (!opts.profilePath && !opts.projectDir) {
    throw new EndToEndRunnerError('RUNNER_INPUT_MISSING', 'Either --project-profile or --project is required');
  }
  if (opts.profilePath && opts.projectDir) {
    throw new EndToEndRunnerError('RUNNER_INPUT_INVALID', 'Cannot specify both --project-profile and --project (spec §86)');
  }

  let profile: ProjectExecutionProfile;
  if (opts.profilePath) {
    profile = await loadProfile(opts.profilePath, root);
  } else {
    // Project mode: load via project adapter (spec §84-85).
    // For v1, this is handled by the runner calling the adapter.
    throw new EndToEndRunnerError('RUNNER_INPUT_MISSING', 'Project mode requires adapter integration');
  }

  const testCases = await loadTestCases(opts.testCasesPath, root);
  const mappings = await loadMappings(opts.mappingsPath, root);
  const dataPlan = opts.dataPlanPath ? await loadDataPlan(opts.dataPlanPath, root) : undefined;
  const preparedData = opts.preparedDataPath ? await loadPreparedData(opts.preparedDataPath, root) : undefined;

  return { profile, testCases, mappings, dataPlan, preparedData };
}
