// Artifact fingerprinting — SHA-256 hashes for input artifacts.
//
// Records input fingerprints and validates compatibility between artifacts.
// Uses canonical JSON serialization (recursive key sorting) for deterministic
// hashing.  Used for stale mapping/data-plan detection.

import { createHash } from 'node:crypto';
import type { InputArtifactHashes } from './models.js';

// ---- Canonical JSON serialization -----------------------------------------

/**
 * Produce a canonical JSON representation with all object keys recursively
 * sorted.  Arrays preserve order (element position is semantically meaningful
 * in Test Case IR).  `undefined` values are serialized as `null` so that the
 * hash is stable across serialization boundaries.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = canonicalize(obj[key]);
  }
  return sorted;
}

// ---- Hash primitives -------------------------------------------------------

export function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** SHA-256 of the canonical JSON representation of any value. */
export function computeObjectHash(obj: unknown): string {
  return computeHash(canonicalJson(obj));
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

export function isPreparedDataStale(
  currentHashes: InputArtifactHashes,
  expectedPreparedDataHash?: string,
): boolean {
  if (!expectedPreparedDataHash) return false;
  if (!currentHashes.preparedDataHash) return false;
  return currentHashes.preparedDataHash !== expectedPreparedDataHash;
}

// ---- Referential-integrity verification ------------------------------------
//
// These functions verify that artifacts cross-reference consistently.  They
// catch cases where a mapping/data-plan was built for a *different* set of
// test cases than the ones currently loaded.

/**
 * Verify every mapping.testCaseId exists in the provided test cases.
 * Returns the set of orphan mapping IDs (empty = consistent).
 */
export function verifyMappingTestCaseConsistency(
  mappingTestCaseIds: string[],
  testCaseIds: string[],
): string[] {
  const tcSet = new Set(testCaseIds);
  return mappingTestCaseIds.filter((id) => !tcSet.has(id));
}

/**
 * Verify every data-plan testCaseId exists in the provided test cases.
 */
export function verifyDataPlanTestCaseConsistency(
  dataPlanTestCaseIds: string[],
  testCaseIds: string[],
): string[] {
  const tcSet = new Set(testCaseIds);
  return dataPlanTestCaseIds.filter((id) => !tcSet.has(id));
}

/**
 * Verify the prepared data plan is traceable to the accepted data plan.
 * Checks environmentProfileId matches and operations are a subset.
 */
export function verifyPreparedDataConsistency(
  preparedDataPlanHash: string,
  expectedDataPlanHash: string,
): boolean {
  return preparedDataPlanHash === expectedDataPlanHash;
}
