// ---------------------------------------------------------------------------
// Test Data Planner – checkpoint loader for stage resume
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  DataRequirementExtractionResult,
  DependencyAnalysisResult,
} from '../models.js';

export interface DataCheckpointData {
  dataRequirements?: DataRequirementExtractionResult;
  dependencyAnalysis?: DependencyAnalysisResult;
}

interface CheckpointMeta {
  fingerprint: string;
}

/**
 * Load checkpoint data from intermediate files if they exist.
 * If `expectedFingerprint` is provided and does not match, all checkpoints
 * are invalidated (returns empty object).
 */
export function loadDataCheckpoint(
  outputDir: string,
  expectedFingerprint?: string,
): DataCheckpointData {
  const intermediateDir = path.join(path.resolve(outputDir), 'intermediate');

  // Fingerprint validation
  if (expectedFingerprint) {
    const metaPath = path.join(intermediateDir, 'checkpoint-meta.json');
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as CheckpointMeta;
        if (meta.fingerprint !== expectedFingerprint) {
          return {};
        }
      } catch {
        return {};
      }
    } else {
      return {};
    }
  }

  const checkpoint: DataCheckpointData = {};

  // Load data requirement extraction
  const dataReqPath = path.join(intermediateDir, 'data-requirements.json');
  if (fs.existsSync(dataReqPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(dataReqPath, 'utf-8'));
      if (raw && Array.isArray(raw.dataCandidates)) {
        checkpoint.dataRequirements = raw as DataRequirementExtractionResult;
      }
    } catch {
      // Invalid file – ignore and re-run
    }
  }

  // Load dependency analysis
  const depPath = path.join(intermediateDir, 'dependency-analysis.json');
  if (fs.existsSync(depPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(depPath, 'utf-8'));
      if (raw && Array.isArray(raw.dependencyCandidates)) {
        checkpoint.dependencyAnalysis = raw as DependencyAnalysisResult;
      }
    } catch {
      // Invalid file – ignore and re-run
    }
  }

  return checkpoint;
}

/**
 * Write a stage checkpoint to disk immediately after completion.
 */
export function writeDataStageCheckpoint(
  outputDir: string,
  stage: 'dataRequirements' | 'dependencyAnalysis',
  data: DataRequirementExtractionResult | DependencyAnalysisResult,
): void {
  const intermediateDir = path.join(path.resolve(outputDir), 'intermediate');
  fs.mkdirSync(intermediateDir, { recursive: true });

  switch (stage) {
    case 'dataRequirements':
      fs.writeFileSync(
        path.join(intermediateDir, 'data-requirements.json'),
        JSON.stringify(data, null, 2),
        'utf-8',
      );
      break;
    case 'dependencyAnalysis':
      fs.writeFileSync(
        path.join(intermediateDir, 'dependency-analysis.json'),
        JSON.stringify(data, null, 2),
        'utf-8',
      );
      break;
  }
}

/**
 * Write checkpoint metadata (fingerprint) for resume validation.
 */
export function writeDataCheckpointMeta(outputDir: string, fingerprint: string): void {
  const intermediateDir = path.join(path.resolve(outputDir), 'intermediate');
  fs.mkdirSync(intermediateDir, { recursive: true });
  fs.writeFileSync(
    path.join(intermediateDir, 'checkpoint-meta.json'),
    JSON.stringify({ fingerprint }, null, 2),
    'utf-8',
  );
}
