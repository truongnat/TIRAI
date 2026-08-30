import * as fs from 'node:fs';
import * as path from 'node:path';
import { requireWorkspace } from '../workspace.js';
import { loadConfig } from '../config.js';
import { loadState } from '../state.js';

export interface StatusOptions {
  cwd: string;
  json?: boolean;
}

export async function runStatus(opts: StatusOptions): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  try {
    loadConfig(paths);
  } catch {
    // ignore
  }
  const state = loadState(paths);

  const hasE2eMapping = fs.existsSync(paths.e2eMappingPath);
  const hasUnitMapping = fs.existsSync(paths.unitMappingPath);
  let e2eMappingsResolved = 0;
  let e2eMappingsMissing = 0;
  let unitMappingsResolved = 0;
  let unitMappingsMissing = 0;

  if (hasE2eMapping) {
    try {
      const raw = JSON.parse(fs.readFileSync(paths.e2eMappingPath, 'utf8'));
      const mappings = (raw as { testMappings?: unknown[] }).testMappings ?? [];
      e2eMappingsResolved = mappings.filter((m: unknown) => (m as { status?: string }).status === 'ready').length;
      e2eMappingsMissing = mappings.length - e2eMappingsResolved;
      if (mappings.length === 0) e2eMappingsMissing = state?.testPlan?.testCaseCount ?? 1;
    } catch {
      // ignore
    }
  } else {
    e2eMappingsMissing = state?.testPlan?.testCaseCount ?? 0;
  }

  if (hasUnitMapping) {
    try {
      const raw = JSON.parse(fs.readFileSync(paths.unitMappingPath, 'utf8'));
      const arr = Array.isArray(raw) ? raw : (raw as { mappings?: unknown[] }).mappings ?? [];
      unitMappingsResolved = Array.isArray(arr) ? arr.length : 0;
      unitMappingsMissing = Math.max(0, (state?.testPlan?.testCaseCount ?? 0) - unitMappingsResolved);
    } catch {
      // ignore
    }
  } else {
    unitMappingsMissing = state?.testPlan?.testCaseCount ?? 0;
  }

  const generatedExists = fs.existsSync(paths.generatedE2eDir) && fs.readdirSync(paths.generatedE2eDir).length > 0;
  const lines = [
    'Workspace:',
    `  ${state ? 'initialized' : 'not initialized'}`,
    '',
    'Source:',
    `  ${state?.source ? path.relative(paths.root, state.source.path) : 'none'}`,
    state?.source ? `  revision: ${state.source.contentHash.slice(0, 8)}` : '',
    '',
    'TestCases:',
    `  ${state?.testPlan?.testCaseCount ?? 0}`,
    '',
    'E2E mappings:',
    `  ${e2eMappingsResolved} resolved`,
    `  ${e2eMappingsMissing} missing`,
    '',
    'Unit mappings:',
    `  ${unitMappingsResolved} resolved`,
    `  ${unitMappingsMissing} missing`,
    '',
    'Generated:',
    `  ${generatedExists ? 'present' : 'stale/missing'}`,
    '',
    'Latest run:',
    `  ${state?.run?.overall ?? 'none'}${state?.run ? ` (${state.run.e2eStatus ?? 'no e2e'}/${state.run.unitStatus ?? 'no unit'})` : ''}`,
  ].filter(Boolean);

  if (opts.json) {
    console.log(JSON.stringify({ state, e2eMappingsResolved, e2eMappingsMissing, unitMappingsResolved, unitMappingsMissing }, null, 2));
  } else {
    console.log(lines.join('\n'));
  }
}
