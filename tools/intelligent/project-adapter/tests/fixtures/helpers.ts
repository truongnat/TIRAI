// Test fixture helpers — factories for building test profiles and configs.

import type {
  ProjectExecutionProfile,
  ProjectIdentity,
  ProjectEnvironmentDefinition,
  UIProjectProfile,
  APIProjectProfile,
  DatabaseProjectProfile,
  RuntimeBindingCatalog,
  SecretReferenceCatalog,
  ProjectCommandCatalog,
  ProjectCapabilities,
  UIElementCatalog,
} from '../../src/models.js';

export function makeIdentity(overrides?: Partial<ProjectIdentity>): ProjectIdentity {
  return {
    id: 'test-project',
    name: 'Test Project',
    root: '/tmp/test',
    adapterId: 'json-project-adapter',
    adapterVersion: '1.0.0',
    ...overrides,
  };
}

export function makeEnvironment(overrides?: Partial<ProjectEnvironmentDefinition>): ProjectEnvironmentDefinition {
  return {
    id: 'local',
    name: 'Local',
    safety: 'isolated',
    ...overrides,
  };
}

export function makeUICatalog(): UIElementCatalog {
  return {
    environmentId: 'local',
    pages: [
      {
        id: 'login-page',
        route: '/login',
        elements: [
          { logicalName: 'username-field', locator: { strategy: 'test-id', value: 'username' } },
          { logicalName: 'password-field', locator: { strategy: 'test-id', value: 'password' }, sensitive: true },
          { logicalName: 'login-button', locator: { strategy: 'test-id', value: 'login-btn' } },
        ],
      },
      {
        id: 'dashboard-page',
        route: '/dashboard',
        elements: [
          { logicalName: 'welcome-marker', locator: { strategy: 'test-id', value: 'welcome' } },
        ],
      },
    ],
  };
}

export function makeUIProfile(): UIProjectProfile {
  return {
    environment: {
      baseUrl: 'http://localhost:3000',
      allowedOrigins: ['http://localhost:3000'],
      browser: 'chromium',
      headless: true,
    },
    catalog: makeUICatalog(),
    executionDefaults: { browser: 'chromium', testIdAttribute: 'data-testid', headless: true },
  };
}

export function makeAPIProfile(): APIProjectProfile {
  return {
    resources: [
      { id: 'auth-api', baseUrlRef: 'environment.apiBaseUrl', authStrategy: { kind: 'bearer', secretRef: 'AUTH_TOKEN' } },
    ],
    operations: [
      { id: 'login', resourceId: 'auth-api', method: 'POST', path: '/auth/login' },
      { id: 'get-user', resourceId: 'auth-api', method: 'GET', path: '/users/{id}' },
    ],
    mappings: [{ logicalEntity: 'user', resourceId: 'auth-api', operationIds: ['login'] }],
  };
}

export function makeDBProfile(): DatabaseProjectProfile {
  return {
    resources: [
      { id: 'db-main', dialect: 'postgresql', database: 'test', connectionSecretRef: 'DB_PASSWORD' },
    ],
    catalogs: [
      {
        resourceId: 'db-main',
        schemas: [
          {
            name: 'public',
            tables: [
              {
                name: 'users',
                columns: [
                  { name: 'id', dataType: 'uuid', nullable: false },
                  { name: 'username', dataType: 'varchar', nullable: false },
                ],
                primaryKey: ['id'],
              },
            ],
          },
        ],
      },
    ],
    mappings: [{ logicalEntity: 'user', resourceId: 'db-main' }],
  };
}

export function makeBindings(): RuntimeBindingCatalog {
  return {
    definitions: [
      { name: 'runtime.username', type: 'runtime', sensitive: false },
      { name: 'runtime.userId', type: 'runtime', sensitive: false },
    ],
  };
}

export function makeSecrets(): SecretReferenceCatalog {
  return {
    references: [
      { name: 'DB_PASSWORD', description: 'Database password' },
      { name: 'AUTH_TOKEN', description: 'Auth token' },
    ],
  };
}

export function makeCommands(): ProjectCommandCatalog {
  return {
    commands: [
      { id: 'npm-start', purpose: 'start', command: 'npm', args: ['run', 'start'], envRefs: [], safeForAutomation: true },
      { id: 'npm-test', purpose: 'test', command: 'npm', args: ['test'], envRefs: [], safeForAutomation: true },
    ],
  };
}

export function makeCapabilities(overrides?: Partial<ProjectCapabilities>): ProjectCapabilities {
  return {
    ui: true,
    api: true,
    database: true,
    multiTenant: false,
    localStart: true,
    testDataMutation: true,
    browserExecution: true,
    apiExecution: true,
    databaseExecution: true,
    ...overrides,
  };
}

export function makeProfile(overrides?: Partial<ProjectExecutionProfile>): ProjectExecutionProfile {
  return {
    schemaVersion: '1.0',
    project: makeIdentity(),
    environment: makeEnvironment(),
    ui: makeUIProfile(),
    api: makeAPIProfile(),
    database: makeDBProfile(),
    bindings: makeBindings(),
    secrets: makeSecrets(),
    commands: makeCommands(),
    capabilities: makeCapabilities(),
    provenance: [
      {
        source: 'tirai.project.json',
        adapterId: 'json-project-adapter',
        adapterVersion: '1.0.0',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    ],
    fingerprint: 'abc123',
    ...overrides,
  };
}
