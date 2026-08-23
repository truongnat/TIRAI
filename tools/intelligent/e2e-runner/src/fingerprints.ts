// Artifact fingerprinting — SHA-256 hashes for input artifacts.
//
// Records input fingerprints and validates compatibility between artifacts.
// Used for stale mapping/data-plan detection.

import { createHash } from 'node:crypto';
import type { InputArtifactHashes } from './models.js';

export function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function computeObjectHash(obj: unknown): string {
  const json = JSON.stringify(obj, Object.keys(obj as Record<string, unknown>).sort());
  return computeHash(json);
}

export function computeInputHashes(
  profileFingerprint: string,
  testCases: unknown,
  mappings: unknown,
  dataPlan?: unknown,
  preparedData?: unknown,
): InputArtifactHashes {
  return {
    profileFingerprint,
    testCasesHash: computeObjectHash(testCases),
    mappingHash: computeObjectHash(mappings),
    dataPlanHash: dataPlan ? computeObjectHash(dataPlan) : undefined,
    preparedDataHash: preparedData ? computeObjectHash(preparedData) : undefined,
  };
}

// ---- Stale detection (spec §20-21) ----------------------------------------

export function isMappingStale(
  currentHashes: InputArtifactHashes,
  expectedMappingHash?: string,
): boolean {
  if (!expectedMappingHash) return false;
  return currentHashes.mappingHash !== expectedMappingHash;
}

export function isDataPlanStale(
  currentHashes: InputArtifactHashes,
  testDataPlanHash?: string,
): boolean {
  if (!testDataPlanHash) return false;
  if (!currentHashes.dataPlanHash) return false;
  return currentHashes.dataPlanHash !== testDataPlanHash;
}
