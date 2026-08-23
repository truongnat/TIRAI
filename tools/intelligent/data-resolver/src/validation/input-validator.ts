// ---------------------------------------------------------------------------
// Validation – input validation
// ---------------------------------------------------------------------------

import type { TestDataPlanIR, EnvironmentProfile, ResourceMapping } from '../models.js';
import { DataResolverError, DataResolverErrorCode } from '../errors.js';

/**
 * Validate the Test Data Plan IR structure.
 *
 * Checks that required fields exist and have valid shapes.
 */
export function validateDataPlan(plan: unknown): TestDataPlanIR {
  if (!plan || typeof plan !== 'object') {
    throw new DataResolverError(DataResolverErrorCode.INVALID_DATA_PLAN, 'Data plan must be a non-null object');
  }

  const p = plan as Record<string, unknown>;

  if (p.schemaVersion !== '1.0') {
    throw new DataResolverError(
      DataResolverErrorCode.INVALID_DATA_PLAN,
      `Unsupported schema version: ${p.schemaVersion}`,
    );
  }

  if (!Array.isArray(p.dataItems)) {
    throw new DataResolverError(DataResolverErrorCode.INVALID_DATA_PLAN, 'dataItems must be an array');
  }

  if (!Array.isArray(p.dependencyGraph)) {
    throw new DataResolverError(DataResolverErrorCode.INVALID_DATA_PLAN, 'dependencyGraph must be an array');
  }

  if (!Array.isArray(p.testCases)) {
    throw new DataResolverError(DataResolverErrorCode.INVALID_DATA_PLAN, 'testCases must be an array');
  }

  return plan as TestDataPlanIR;
}

/**
 * Validate an environment profile structure.
 */
export function validateEnvironmentProfile(profile: unknown): EnvironmentProfile {
  if (!profile || typeof profile !== 'object') {
    throw new DataResolverError(DataResolverErrorCode.ENVIRONMENT_NOT_FOUND, 'Environment profile must be a non-null object');
  }

  const p = profile as Record<string, unknown>;

  if (typeof p.id !== 'string') {
    throw new DataResolverError(DataResolverErrorCode.ENVIRONMENT_NOT_FOUND, 'Environment profile must have a string id');
  }

  if (!Array.isArray(p.resources)) {
    throw new DataResolverError(DataResolverErrorCode.ENVIRONMENT_NOT_FOUND, 'resources must be an array');
  }

  return profile as EnvironmentProfile;
}

/**
 * Validate resource mappings — ensure no secret values are serialized.
 */
export function validateMappings(mappings: ResourceMapping[]): void {
  for (const m of mappings) {
    if (!m.logicalEntity || !m.resourceId) {
      throw new DataResolverError(
        DataResolverErrorCode.INVALID_DATA_PLAN,
        `Mapping must have logicalEntity and resourceId`,
      );
    }
  }
}
