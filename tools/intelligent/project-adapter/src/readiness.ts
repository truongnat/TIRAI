// Readiness derivation — determines if downstream modules can consume profile.
//
// Readiness means metadata complete, NOT safe to execute.
// Actual execution still requires runtime safety policy.

import type {
  ProjectExecutionProfile,
  ProjectReadiness,
  ProjectReadinessBlocker,
  ProjectProfileQuality,
} from './models.js';

export function deriveReadiness(
  profile: ProjectExecutionProfile,
): ProjectReadiness {
  const blockers: ProjectReadinessBlocker[] = [];

  // Execution Mapping Builder readiness: needs at least one executor profile.
  const hasExecutor = !!(profile.ui || profile.api || profile.database);
  if (!hasExecutor) {
    blockers.push({
      area: 'ui',
      description: 'No executor profiles configured (UI/API/DB)',
    });
  }

  // UI execution readiness.
  const uiReady = !!profile.ui &&
    profile.ui.catalog.pages.length > 0 &&
    profile.ui.catalog.pages.some((p) => p.elements.length > 0);
  if (!uiReady && !profile.ui) {
    blockers.push({
      area: 'ui',
      description: 'No UI profile configured',
    });
  } else if (!uiReady && profile.ui) {
    blockers.push({
      area: 'ui',
      description: 'UI catalog has no pages or elements',
    });
  }

  // API execution readiness.
  const apiReady = !!profile.api &&
    profile.api.resources.length > 0 &&
    profile.api.operations.length > 0;
  if (!apiReady && !profile.api) {
    blockers.push({
      area: 'api',
      description: 'No API profile configured',
    });
  } else if (!apiReady && profile.api) {
    blockers.push({
      area: 'api',
      description: 'API profile has no resources or operations',
    });
  }

  // Database execution readiness.
  const dbReady = !!profile.database &&
    profile.database.resources.length > 0 &&
    profile.database.catalogs.length > 0;
  if (!dbReady && !profile.database) {
    blockers.push({
      area: 'database',
      description: 'No database profile configured',
    });
  } else if (!dbReady && profile.database) {
    blockers.push({
      area: 'database',
      description: 'Database profile has no resources or catalogs',
    });
  }

  // Environment readiness.
  if (profile.environment.safety === 'unknown') {
    blockers.push({
      area: 'environment',
      description: 'Environment safety classification is unknown',
    });
  }

  // E2E runner readiness: needs environment + at least one executor.
  const e2eReady = hasExecutor && profile.environment.safety !== 'unknown';

  return {
    executionMappingReady: hasExecutor,
    uiExecutionReady: uiReady,
    apiExecutionReady: apiReady,
    databaseExecutionReady: dbReady,
    endToEndRunnerReady: e2eReady,
    blockers,
  };
}

export function deriveQuality(
  profile: ProjectExecutionProfile,
  warningCount: number,
  invalidRefCount: number,
): ProjectProfileQuality {
  let uiPages = 0;
  let uiElements = 0;
  if (profile.ui) {
    uiPages = profile.ui.catalog.pages.length;
    uiElements = profile.ui.catalog.pages.reduce(
      (sum, p) => sum + p.elements.length,
      0,
    );
  }

  let apiOperations = 0;
  if (profile.api) {
    apiOperations = profile.api.operations.length;
  }

  let databaseTables = 0;
  if (profile.database) {
    for (const cat of profile.database.catalogs) {
      for (const schema of cat.schemas) {
        databaseTables += schema.tables.length;
      }
    }
  }

  const resources =
    (profile.ui ? 1 : 0) +
    (profile.api ? profile.api.resources.length : 0) +
    (profile.database ? profile.database.resources.length : 0);

  const readiness = deriveReadiness(profile);
  const totalAreas = 5; // ui, api, db, mapping, e2e
  const readyAreas = [
    readiness.executionMappingReady,
    readiness.uiExecutionReady,
    readiness.apiExecutionReady,
    readiness.databaseExecutionReady,
    readiness.endToEndRunnerReady,
  ].filter(Boolean).length;

  return {
    resources,
    validResources: resources - invalidRefCount,
    uiPages,
    uiElements,
    apiOperations,
    databaseTables,
    bindings: profile.bindings.definitions.length,
    secretRefs: profile.secrets.references.length,
    commands: profile.commands.commands.length,
    invalidReferences: invalidRefCount,
    warnings: warningCount,
    readinessScore: totalAreas > 0 ? readyAreas / totalAreas : 0,
  };
}
