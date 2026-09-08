import * as path from 'node:path';
import { type WorkspacePaths, atomicWriteJson, readJsonIfExists, ensureDir, WORKSPACE_VERSION } from './workspace.js';

export interface WorkspaceState {
  version: number;
  workspaceVersion: number;
  initializedAt: string;
  source?: {
    path: string;
    contentHash: string;
    byteLength: number;
    ingestedAt: string;
    artifactCount: number;
    contextCount: number;
  };
  testPlan?: {
    requirementCount: number;
    scenarioCount: number;
    testCaseCount: number;
    ingestedAt: string;
  };
  generation?: {
    at: string;
    e2eFiles: string[];
    unitFiles: string[];
    generationAiCalls: number;
    guessedMappings: number;
    aiSymbolGuesses: number;
  };
  run?: {
    at: string;
    runId: string;
    e2eStatus?: string;
    unitStatus?: string;
    overall?: string;
  };
  platformConfig?: {
    updatedAt: string;
  };
  specRegistry?: {
    count: number;
    updatedAt: string;
  };
}

export function loadState(paths: WorkspacePaths): WorkspaceState | null {
  return readJsonIfExists<WorkspaceState>(paths.statePath);
}

export function saveState(paths: WorkspacePaths, state: WorkspaceState): void {
  ensureDir(path.dirname(paths.statePath));
  atomicWriteJson(paths.statePath, state);
}

export function initState(paths: WorkspacePaths): WorkspaceState {
  const existing = loadState(paths);
  if (existing) {
    if (existing.version !== 1 || existing.workspaceVersion !== WORKSPACE_VERSION) {
      throw new Error(`Unsupported workspace version ${existing.version}`);
    }
    return existing;
  }
  const state: WorkspaceState = {
    version: 1,
    workspaceVersion: WORKSPACE_VERSION,
    initializedAt: new Date().toISOString(),
  };
  saveState(paths, state);
  return state;
}

export function updateState(paths: WorkspacePaths, updater: (s: WorkspaceState) => WorkspaceState): WorkspaceState {
  const current = loadState(paths) ?? {
    version: 1,
    workspaceVersion: WORKSPACE_VERSION,
    initializedAt: new Date().toISOString(),
  };
  const next = updater(current);
  saveState(paths, next);
  return next;
}
