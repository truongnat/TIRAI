// ---------------------------------------------------------------------------
// TIRAI — Platform and Target Configuration
// ---------------------------------------------------------------------------
// Per TIRAI v1 spec §4: project configuration must be platform-aware and
// environment-aware. The config supports Web, Backend/API, Mobile, and
// Database platforms, each with one or more environments.

// ---- Platform types -------------------------------------------------------

export type PlatformType = 'web' | 'backend' | 'mobile' | 'database';

export type EnvironmentName = string;

export type SecretRef = `env:${string}`;

// ---- Web platform ---------------------------------------------------------

export interface WebAuthConfig {
  type: 'basic' | 'bearer' | 'oauth' | 'cookie' | 'none';
  usernameRef?: SecretRef;
  passwordRef?: SecretRef;
  tokenRef?: SecretRef;
}

export interface WebCapabilityConfig {
  browser?: 'chromium' | 'firefox' | 'webkit';
  screenshots?: boolean;
  traces?: boolean;
  networkCapture?: boolean;
  consoleCapture?: boolean;
}

export interface WebEnvironmentConfig {
  baseUrl: string;
  auth?: WebAuthConfig;
  capabilities?: WebCapabilityConfig;
  viewport?: { width: number; height: number };
}

export interface WebConfig {
  enabled: boolean;
  environments: Record<EnvironmentName, WebEnvironmentConfig>;
}

// ---- Backend / API platform ----------------------------------------------

export interface BackendAuthConfig {
  type: 'bearer' | 'api-key' | 'basic' | 'none';
  tokenRef?: SecretRef;
  headerName?: string;
}

export interface BackendEnvironmentConfig {
  baseUrl: string;
  auth?: BackendAuthConfig;
  headers?: Record<string, string>;
  rateLimitPolicy?: { maxRequestsPerMinute: number };
}

export interface BackendConfig {
  enabled: boolean;
  environments: Record<EnvironmentName, BackendEnvironmentConfig>;
  contractRefs?: string[];
}

// ---- Mobile platform ------------------------------------------------------

export interface MobileTargetConfig {
  platform: 'android' | 'ios';
  packageName?: string;
  bundleId?: string;
  appArtifactRef?: SecretRef;
  deviceProfile?: string;
  installStrategy?: 'preinstalled' | 'install-from-ref';
  deepLinkScheme?: string;
}

export interface MobileConfig {
  enabled: boolean;
  targets: MobileTargetConfig[];
}

// ---- Database platform ----------------------------------------------------

export interface DatabaseEnvironmentConfig {
  type: 'postgres' | 'mysql' | 'mongodb' | 'sqlite';
  connectionRef: SecretRef;
  schema?: string;
  readOnly?: boolean;
  allowedTables?: string[];
}

export interface DatabaseConfig {
  enabled: boolean;
  environments: Record<EnvironmentName, DatabaseEnvironmentConfig>;
}

// ---- Top-level platform configuration ------------------------------------

export interface PlatformConfig {
  web?: WebConfig;
  backend?: BackendConfig;
  mobile?: MobileConfig;
  database?: DatabaseConfig;
}

// ---- Validation -----------------------------------------------------------

export interface ConfigValidationResult {
  valid: boolean;
  errors: ConfigValidationError[];
}

export interface ConfigValidationError {
  path: string;
  message: string;
}

/**
 * Validate a PlatformConfig. Every enabled platform must have at least one
 * environment (or targets, for mobile). Secrets must use env: references.
 */
export function validatePlatformConfig(config: PlatformConfig): ConfigValidationResult {
  const errors: ConfigValidationError[] = [];

  if (config.web?.enabled) {
    const envs = Object.keys(config.web.environments);
    if (envs.length === 0) {
      errors.push({ path: 'web.environments', message: 'Web platform enabled but no environments configured' });
    }
    for (const [name, env] of Object.entries(config.web.environments)) {
      if (!env.baseUrl || typeof env.baseUrl !== 'string') {
        errors.push({ path: `web.environments.${name}.baseUrl`, message: 'Web environment requires baseUrl' });
      }
      if (env.auth) {
        validateAuthSecrets(env.auth, `web.environments.${name}.auth`, errors);
      }
    }
  }

  if (config.backend?.enabled) {
    const envs = Object.keys(config.backend.environments);
    if (envs.length === 0) {
      errors.push({ path: 'backend.environments', message: 'Backend platform enabled but no environments configured' });
    }
    for (const [name, env] of Object.entries(config.backend.environments)) {
      if (!env.baseUrl || typeof env.baseUrl !== 'string') {
        errors.push({ path: `backend.environments.${name}.baseUrl`, message: 'Backend environment requires baseUrl' });
      }
      if (env.auth?.tokenRef && !env.auth.tokenRef.startsWith('env:')) {
        errors.push({ path: `backend.environments.${name}.auth.tokenRef`, message: 'Secret must use env:NAME reference' });
      }
    }
  }

  if (config.mobile?.enabled) {
    if (config.mobile.targets.length === 0) {
      errors.push({ path: 'mobile.targets', message: 'Mobile platform enabled but no targets configured' });
    }
    for (const [i, target] of config.mobile.targets.entries()) {
      if (!target.packageName && !target.bundleId) {
        errors.push({ path: `mobile.targets[${i}]`, message: 'Mobile target requires packageName or bundleId' });
      }
      if (target.appArtifactRef && !target.appArtifactRef.startsWith('env:')) {
        errors.push({ path: `mobile.targets[${i}].appArtifactRef`, message: 'Artifact reference must use env:NAME' });
      }
    }
  }

  if (config.database?.enabled) {
    const envs = Object.keys(config.database.environments);
    if (envs.length === 0) {
      errors.push({ path: 'database.environments', message: 'Database platform enabled but no environments configured' });
    }
    for (const [name, env] of Object.entries(config.database.environments)) {
      if (!env.connectionRef || !env.connectionRef.startsWith('env:')) {
        errors.push({ path: `database.environments.${name}.connectionRef`, message: 'Database connection must use env:NAME reference' });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function validateAuthSecrets(
  auth: WebAuthConfig,
  path: string,
  errors: ConfigValidationError[],
): void {
  if (auth.usernameRef && !auth.usernameRef.startsWith('env:')) {
    errors.push({ path: `${path}.usernameRef`, message: 'Secret must use env:NAME reference' });
  }
  if (auth.passwordRef && !auth.passwordRef.startsWith('env:')) {
    errors.push({ path: `${path}.passwordRef`, message: 'Secret must use env:NAME reference' });
  }
  if (auth.tokenRef && !auth.tokenRef.startsWith('env:')) {
    errors.push({ path: `${path}.tokenRef`, message: 'Secret must use env:NAME reference' });
  }
}

/**
 * Resolve a secret reference. Returns the env var name (without `env:` prefix)
 * or null if not a valid reference.
 */
export function resolveSecretRef(ref: SecretRef): string {
  return ref.startsWith('env:') ? ref.slice(4) : ref;
}

/**
 * Default empty platform config.
 */
export function defaultPlatformConfig(): PlatformConfig {
  return {
    web: {
      enabled: false,
      environments: {},
    },
    backend: {
      enabled: false,
      environments: {},
    },
    mobile: {
      enabled: false,
      targets: [],
    },
    database: {
      enabled: false,
      environments: {},
    },
  };
}
