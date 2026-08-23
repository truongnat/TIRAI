// ---------------------------------------------------------------------------
// Test Planner – checkpoint loader for stage resume
// ---------------------------------------------------------------------------
// Supports resuming from the last completed stage when intermediate files
// exist on disk. This avoids re-running expensive AI calls when a later
// stage fails.
//
// Checkpoints are fingerprinted: if the input Requirement IR, prompt version,
// or model changes, all checkpoints are invalidated to prevent stale output
// from being reused under a different contract.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  CoverageAnalysisResult,
  ScenarioCandidate,
  TestCaseCandidate,
} from '../models.js';

export interface CheckpointData {
  coverage?: CoverageAnalysisResult;
  scenarios?: ScenarioCandidate[];
  testCases?: TestCaseCandidate[];
}

interface CheckpointMeta {
  fingerprint: string;
}

/**
 * Load checkpoint data from intermediate files if they exist.
 * Returns undefined for stages that haven't been completed yet.
 *
 * If `expectedFingerprint` is provided and does not match the stored
 * fingerprint, all checkpoints are invalidated (returns empty object).
 */
export function loadCheckpoint(
  outputDir: string,
  expectedFingerprint?: string,
): CheckpointData {
  const intermediateDir = path.join(path.resolve(outputDir), 'intermediate');

  // Fingerprint validation – if mismatch, invalidate all checkpoints
  if (expectedFingerprint) {
    const metaPath = path.join(intermediateDir, 'checkpoint-meta.json');
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as CheckpointMeta;
        if (meta.fingerprint !== expectedFingerprint) {
          // Fingerprint mismatch – stale checkpoints, ignore all
          return {};
        }
      } catch {
        // Invalid meta file – treat as mismatch
        return {};
      }
    } else {
      // No meta file but fingerprint expected – can't validate
      return {};
    }
  }

  const checkpoint: CheckpointData = {};

  // Load coverage analysis
  const coveragePath = path.join(intermediateDir, 'coverage-analysis.json');
  if (fs.existsSync(coveragePath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(coveragePath, 'utf-8'));
      if (raw && Array.isArray(raw.coverageCandidates)) {
        checkpoint.coverage = raw as CoverageAnalysisResult;
      }
    } catch {
      // Invalid file – ignore and re-run
    }
  }

  // Load scenario candidates
  const scenarioPath = path.join(intermediateDir, 'scenario-candidates.json');
  if (fs.existsSync(scenarioPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(scenarioPath, 'utf-8'));
      if (raw && Array.isArray(raw.scenarios)) {
        checkpoint.scenarios = raw.scenarios as ScenarioCandidate[];
      }
    } catch {
      // Invalid file – ignore and re-run
    }
  }

  // Load test case candidates
  const testCasePath = path.join(intermediateDir, 'test-case-candidates.json');
  if (fs.existsSync(testCasePath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(testCasePath, 'utf-8'));
      if (raw && Array.isArray(raw.testCases)) {
        checkpoint.testCases = raw.testCases as TestCaseCandidate[];
      }
    } catch {
      // Invalid file – ignore and re-run
    }
  }

  return checkpoint;
}

/**
 * Write a stage checkpoint to disk immediately after completion.
 * This enables resuming from this point if a later stage fails.
 */
export function writeStageCheckpoint(
  outputDir: string,
  stage: 'coverage' | 'scenarios' | 'testCases',
  data: CoverageAnalysisResult | ScenarioCandidate[] | TestCaseCandidate[],
): void {
  const intermediateDir = path.join(path.resolve(outputDir), 'intermediate');
  fs.mkdirSync(intermediateDir, { recursive: true });

  switch (stage) {
    case 'coverage':
      fs.writeFileSync(
        path.join(intermediateDir, 'coverage-analysis.json'),
        JSON.stringify(data, null, 2),
        'utf-8',
      );
      break;
    case 'scenarios':
      fs.writeFileSync(
        path.join(intermediateDir, 'scenario-candidates.json'),
        JSON.stringify({ scenarios: data }, null, 2),
        'utf-8',
      );
      break;
    case 'testCases':
      fs.writeFileSync(
        path.join(intermediateDir, 'test-case-candidates.json'),
        JSON.stringify({ testCases: data }, null, 2),
        'utf-8',
      );
      break;
  }
}

/**
 * Write checkpoint metadata (fingerprint) so resume can validate staleness.
 * Should be called once at the start of a planning run, before any stages.
 */
export function writeCheckpointMeta(outputDir: string, fingerprint: string): void {
  const intermediateDir = path.join(path.resolve(outputDir), 'intermediate');
  fs.mkdirSync(intermediateDir, { recursive: true });
  fs.writeFileSync(
    path.join(intermediateDir, 'checkpoint-meta.json'),
    JSON.stringify({ fingerprint }, null, 2),
    'utf-8',
  );
}
