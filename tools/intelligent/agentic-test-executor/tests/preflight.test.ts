import { describe, expect, it } from 'vitest';
import { runRealAppPreflight } from '../src/real-app/preflight.js';

function input(overrides: Partial<Parameters<typeof runRealAppPreflight>[0]> = {}): Parameters<typeof runRealAppPreflight>[0] {
  return {
    baseUrl: 'https://example.com/app',
    allowedOrigins: ['https://example.com'],
    environment: 'non-production',
    mutationDenied: true,
    credentialRefs: ['secret://msale/username', 'secret://msale/password'],
    resolveCredentialRef: async () => true,
    checkBrowser: async () => true,
    observeLoginPage: async () => ({ observable: true, route: '/login' }),
    fetchImpl: async () => new Response('ok', { status: 200 }),
    ...overrides,
  };
}

describe('runRealAppPreflight', () => {
  it('returns READY without exposing credential values', async () => {
    const result = await runRealAppPreflight(input());
    expect(result.status).toBe('READY');
    expect(result.canonicalBaseUrl).toBe('https://example.com/app/');
    expect(result.checks).toEqual({
      baseUrlReachable: true,
      expectedOriginAllowed: true,
      credentialReferencesResolvable: true,
      browserAvailable: true,
      loginPageObservable: true,
      mutationSafe: true,
    });
  });

  it('blocks when a credential capability is unavailable', async () => {
    const result = await runRealAppPreflight(input({ resolveCredentialRef: async () => false }));
    expect(result.status).toBe('BLOCKED');
    expect(result.failureCode).toBe('CREDENTIAL_CAPABILITY_UNAVAILABLE');
    expect(JSON.stringify(result)).not.toContain('password-value');
  });

  it('returns ERROR for unreachable application or browser failure', async () => {
    const unreachable = await runRealAppPreflight(input({
      fetchImpl: async () => { throw new Error('network'); },
    }));
    expect(unreachable.status).toBe('ERROR');
    expect(unreachable.failureCode).toBe('APPLICATION_UNREACHABLE');

    const browserFailure = await runRealAppPreflight(input({ checkBrowser: async () => { throw new Error('launch'); } }));
    expect(browserFailure.status).toBe('ERROR');
    expect(browserFailure.failureCode).toBe('BROWSER_INFRASTRUCTURE_FAILURE');
  });
});
