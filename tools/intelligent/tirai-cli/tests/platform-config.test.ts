// ---------------------------------------------------------------------------
// TIRAI — Platform config tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  validatePlatformConfig,
  defaultPlatformConfig,
  resolveSecretRef,
  type PlatformConfig,
} from '../src/platform-config.js';

describe('platform config validation', () => {
  it('validates a correct web config', () => {
    const config: PlatformConfig = {
      web: {
        enabled: true,
        environments: {
          staging: { baseUrl: 'https://staging.example.com' },
          production: { baseUrl: 'https://example.com' },
        },
      },
    };
    const result = validatePlatformConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects web config without environments', () => {
    const config: PlatformConfig = {
      web: { enabled: true, environments: {} },
    };
    const result = validatePlatformConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ path: 'web.environments' }),
    );
  });

  it('rejects web config without baseUrl', () => {
    const config: PlatformConfig = {
      web: {
        enabled: true,
        environments: { staging: { baseUrl: '' } },
      },
    };
    const result = validatePlatformConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ path: 'web.environments.staging.baseUrl' }),
    );
  });

  it('rejects plaintext secrets (not env: references)', () => {
    const config: PlatformConfig = {
      web: {
        enabled: true,
        environments: {
          staging: {
            baseUrl: 'https://staging.example.com',
            auth: {
              type: 'basic',
              usernameRef: 'admin' as any, // should be env:NAME
              passwordRef: 'secret123' as any, // should be env:NAME
            },
          },
        },
      },
    };
    const result = validatePlatformConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ path: 'web.environments.staging.auth.usernameRef' }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ path: 'web.environments.staging.auth.passwordRef' }),
    );
  });

  it('accepts valid env: secret references', () => {
    const config: PlatformConfig = {
      web: {
        enabled: true,
        environments: {
          staging: {
            baseUrl: 'https://staging.example.com',
            auth: {
              type: 'basic',
              usernameRef: 'env:TIRAI_WEB_USERNAME',
              passwordRef: 'env:TIRAI_WEB_PASSWORD',
            },
          },
        },
      },
    };
    const result = validatePlatformConfig(config);
    expect(result.valid).toBe(true);
  });

  it('validates backend config', () => {
    const config: PlatformConfig = {
      backend: {
        enabled: true,
        environments: {
          staging: { baseUrl: 'https://api-staging.example.com' },
        },
      },
    };
    const result = validatePlatformConfig(config);
    expect(result.valid).toBe(true);
  });

  it('validates database config with env: connection ref', () => {
    const config: PlatformConfig = {
      database: {
        enabled: true,
        environments: {
          staging: {
            type: 'postgres',
            connectionRef: 'env:TIRAI_DATABASE_URL',
            readOnly: true,
          },
        },
      },
    };
    const result = validatePlatformConfig(config);
    expect(result.valid).toBe(true);
  });

  it('rejects database config with plaintext connection', () => {
    const config: PlatformConfig = {
      database: {
        enabled: true,
        environments: {
          staging: {
            type: 'postgres',
            connectionRef: 'postgresql://user:pass@host/db' as any,
          },
        },
      },
    };
    const result = validatePlatformConfig(config);
    expect(result.valid).toBe(false);
  });

  it('validates mobile config', () => {
    const config: PlatformConfig = {
      mobile: {
        enabled: true,
        targets: [
          { platform: 'android', packageName: 'com.example.app' },
          { platform: 'ios', bundleId: 'com.example.app' },
        ],
      },
    };
    const result = validatePlatformConfig(config);
    expect(result.valid).toBe(true);
  });

  it('rejects mobile target without package/bundle', () => {
    const config: PlatformConfig = {
      mobile: {
        enabled: true,
        targets: [{ platform: 'android' }],
      },
    };
    const result = validatePlatformConfig(config);
    expect(result.valid).toBe(false);
  });
});

describe('defaultPlatformConfig', () => {
  it('returns disabled platforms', () => {
    const config = defaultPlatformConfig();
    expect(config.web?.enabled).toBe(false);
    expect(config.backend?.enabled).toBe(false);
    expect(config.mobile?.enabled).toBe(false);
    expect(config.database?.enabled).toBe(false);
  });
});

describe('resolveSecretRef', () => {
  it('extracts env var name', () => {
    expect(resolveSecretRef('env:TIRAI_WEB_PASSWORD')).toBe('TIRAI_WEB_PASSWORD');
  });
});
