// Execution Mapping Builder — Checkpoint/resume.
//
// Saves intermediate results to disk so the builder can resume without
// re-processing completed stages.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckpointMetadata, ExecutionMappingIR, ExecutorCandidate } from './models.js';
import { computeFingerprint, type FingerprintInput } from './fingerprint.js';

// ---- Checkpoint store ------------------------------------------------------

export class CheckpointStore {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  // ---- Save checkpoint -----------------------------------------------------

  saveCheckpoint(
    stage: CheckpointMetadata['stage'],
    fingerprint: string,
    data: unknown,
    providerName?: string,
    model?: string,
  ): void {
    const meta: CheckpointMetadata = {
      stage,
      fingerprint,
      timestamp: new Date().toISOString(),
      providerName,
      model,
      completedBatches: [],
    };

    writeFileSync(join(this.dir, 'checkpoint-meta.json'), JSON.stringify(meta, null, 2));
    writeFileSync(join(this.dir, `${stage}.json`), JSON.stringify(data, null, 2));
  }

  // ---- Load checkpoint -----------------------------------------------------

  loadCheckpoint(fingerprint: string): { meta: CheckpointMetadata; data: unknown } | null {
    const metaPath = join(this.dir, 'checkpoint-meta.json');
    if (!existsSync(metaPath)) return null;

    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as CheckpointMetadata;
      if (meta.fingerprint !== fingerprint) return null; // Input changed → invalidate

      const dataPath = join(this.dir, `${meta.stage}.json`);
      if (!existsSync(dataPath)) return null;

      const data = JSON.parse(readFileSync(dataPath, 'utf-8'));
      return { meta, data };
    } catch {
      return null;
    }
  }

  // ---- Check if checkpoint is valid ----------------------------------------

  isValid(fingerprint: string): boolean {
    return this.loadCheckpoint(fingerprint) !== null;
  }

  // ---- Save candidates -----------------------------------------------------

  saveCandidates(candidates: ExecutorCandidate[], fingerprint: string): void {
    this.saveCheckpoint('candidates', fingerprint, candidates);
  }

  // ---- Load candidates -----------------------------------------------------

  loadCandidates(fingerprint: string): ExecutorCandidate[] | null {
    const result = this.loadCheckpoint(fingerprint);
    if (!result || result.meta.stage !== 'candidates') return null;
    return result.data as ExecutorCandidate[];
  }

  // ---- Save final mapping --------------------------------------------------

  saveMapping(mapping: ExecutionMappingIR, fingerprint: string): void {
    this.saveCheckpoint('complete', fingerprint, mapping);
  }

  // ---- Load final mapping --------------------------------------------------

  loadMapping(fingerprint: string): ExecutionMappingIR | null {
    const result = this.loadCheckpoint(fingerprint);
    if (!result || result.meta.stage !== 'complete') return null;
    return result.data as ExecutionMappingIR;
  }
}

// ---- Create fingerprint from options ---------------------------------------

export function createFingerprint(input: FingerprintInput): string {
  return computeFingerprint(input);
}
