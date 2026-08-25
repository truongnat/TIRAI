// Safe real-application acceptance preflight.
//
// This module deliberately receives capability adapters. It never reads a
// credential value itself and never performs a business mutation.

import { normalizeBaseUrl } from '../runtime/base-url.js';

export type RealAppPreflightStatus = 'READY' | 'BLOCKED' | 'ERROR';

export interface RealAppPreflightInput {
  baseUrl: string;
  allowedOrigins: string[];
  environment: 'non-production' | 'production' | 'unknown';
  mutationDenied: boolean;
  credentialRefs: string[];
  resolveCredentialRef: (ref: string) => Promise<boolean>;
  checkBrowser: () => Promise<boolean>;
  observeLoginPage: (canonicalBaseUrl: string) => Promise<{ observable: boolean; route?: string }>;
  fetchImpl?: typeof fetch;
}

export interface RealAppPreflightResult {
  status: RealAppPreflightStatus;
  canonicalBaseUrl?: string;
  checks: {
    baseUrlReachable: boolean;
    expectedOriginAllowed: boolean;
    credentialReferencesResolvable: boolean;
    browserAvailable: boolean;
    loginPageObservable: boolean;
    mutationSafe: boolean;
  };
  failureCode?: 'APPLICATION_UNREACHABLE' | 'CREDENTIAL_CAPABILITY_UNAVAILABLE' | 'BROWSER_INFRASTRUCTURE_FAILURE' | 'LOGIN_PAGE_UNOBSERVABLE' | 'UNSAFE_ENVIRONMENT';
}

export async function runRealAppPreflight(input: RealAppPreflightInput): Promise<RealAppPreflightResult> {
  const checks = {
    baseUrlReachable: false,
    expectedOriginAllowed: false,
    credentialReferencesResolvable: false,
    browserAvailable: false,
    loginPageObservable: false,
    mutationSafe: input.environment === 'non-production' || input.mutationDenied,
  };

  let canonicalBaseUrl: string;
  try {
    canonicalBaseUrl = normalizeBaseUrl(input.baseUrl);
  } catch {
    return { status: 'ERROR', checks, failureCode: 'APPLICATION_UNREACHABLE' };
  }

  const origin = new URL(canonicalBaseUrl).origin;
  checks.expectedOriginAllowed = input.allowedOrigins.some((allowed) => allowed === origin);
  if (!checks.expectedOriginAllowed) {
    return { status: 'ERROR', canonicalBaseUrl, checks, failureCode: 'APPLICATION_UNREACHABLE' };
  }

  try {
    const response = await (input.fetchImpl ?? fetch)(canonicalBaseUrl, { method: 'GET', redirect: 'manual' });
    checks.baseUrlReachable = response.status >= 200 && response.status < 500;
  } catch {
    return { status: 'ERROR', canonicalBaseUrl, checks, failureCode: 'APPLICATION_UNREACHABLE' };
  }
  if (!checks.baseUrlReachable) {
    return { status: 'ERROR', canonicalBaseUrl, checks, failureCode: 'APPLICATION_UNREACHABLE' };
  }

  try {
    checks.browserAvailable = await input.checkBrowser();
  } catch {
    return { status: 'ERROR', canonicalBaseUrl, checks, failureCode: 'BROWSER_INFRASTRUCTURE_FAILURE' };
  }
  if (!checks.browserAvailable) {
    return { status: 'ERROR', canonicalBaseUrl, checks, failureCode: 'BROWSER_INFRASTRUCTURE_FAILURE' };
  }

  try {
    checks.credentialReferencesResolvable = input.credentialRefs.length > 0
      && (await Promise.all(input.credentialRefs.map((ref) => input.resolveCredentialRef(ref)))).every(Boolean);
  } catch {
    checks.credentialReferencesResolvable = false;
  }
  if (!checks.credentialReferencesResolvable) {
    return { status: 'BLOCKED', canonicalBaseUrl, checks, failureCode: 'CREDENTIAL_CAPABILITY_UNAVAILABLE' };
  }

  try {
    checks.loginPageObservable = (await input.observeLoginPage(canonicalBaseUrl)).observable;
  } catch {
    return { status: 'ERROR', canonicalBaseUrl, checks, failureCode: 'LOGIN_PAGE_UNOBSERVABLE' };
  }
  if (!checks.loginPageObservable) {
    return { status: 'ERROR', canonicalBaseUrl, checks, failureCode: 'LOGIN_PAGE_UNOBSERVABLE' };
  }
  if (!checks.mutationSafe) {
    return { status: 'BLOCKED', canonicalBaseUrl, checks, failureCode: 'UNSAFE_ENVIRONMENT' };
  }

  return { status: 'READY', canonicalBaseUrl, checks };
}
