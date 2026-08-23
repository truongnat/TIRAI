// API Executor v1 — URL safety and SSRF protection.
//
// Base URLs come exclusively from environment resources. Allowing an operation
// to provide its own origin would bypass SSRF policy enforcement.

import { ApiErrorCode, ApiExecutorError } from '../errors.js';
import { DEFAULT_NETWORK_POLICY, type NetworkPolicy } from '../models.js';
const PRIVATE_IP_PATTERNS: ReadonlyArray<RegExp> = [
  /^127\./, // IPv4 loopback
  /^10\./, // Class A private
  /^172\.(1[6-9]|2\d|3[01])\./, // Class B private
  /^192\.168\./, // Class C private
  /^169\.254\./, // Link-local (cloud metadata)
  /^0\./, // Current network
  /^::1$/, // IPv6 loopback
  /^fe80:/i, // IPv6 link-local
  /^fc00:/i, // IPv6 unique local
  /^fd/i, // IPv6 unique local prefix
];

const METADATA_IPS: ReadonlySet<string> = new Set([
  '169.254.169.254', // AWS/GCP metadata
  '100.100.100.200', // Alibaba metadata
]);

export function validateProtocol(url: URL): void {
  if (url.protocol === 'https:') return;
  if (url.protocol === 'http:') return;
  throw new ApiExecutorError(
    ApiErrorCode.API_UNSUPPORTED_PROTOCOL,
    `Unsupported protocol: ${url.protocol}. Only https: and http: are permitted.`,
  );
}

export function validateHttpAllowed(
  url: URL,
  policy: NetworkPolicy,
): void {
  if (url.protocol === 'http:' && !policy.allowHttp) {
    throw new ApiExecutorError(
      ApiErrorCode.API_UNSUPPORTED_PROTOCOL,
      'HTTP is not allowed by network policy. Set allowHttp=true to permit insecure transport.',
    );
  }
}

export function validateHost(
  url: URL,
  policy: NetworkPolicy,
): void {
  const hostname = url.hostname;

  // Check metadata IPs
  if (METADATA_IPS.has(hostname)) {
    throw new ApiExecutorError(
      ApiErrorCode.API_UNSAFE_URL,
      `Access to cloud metadata endpoint ${hostname} is forbidden.`,
    );
  }

  // Check private network
  if (!policy.allowPrivateNetwork) {
    for (const pattern of PRIVATE_IP_PATTERNS) {
      if (pattern.test(hostname)) {
        throw new ApiExecutorError(
          ApiErrorCode.API_UNSAFE_URL,
          `Access to private network address ${hostname} is forbidden by network policy.`,
        );
      }
    }
  }

  // Check allowed hosts
  if (policy.allowedHosts.length > 0 && !policy.allowedHosts.includes(hostname)) {
    throw new ApiExecutorError(
      ApiErrorCode.API_UNSAFE_URL,
      `Host ${hostname} is not in the allowed hosts list.`,
    );
  }
}

export function validateOrigin(
  url: URL,
  policy: NetworkPolicy,
): void {
  if (policy.allowedOrigins.length === 0) return;
  const origin = url.origin;
  if (!policy.allowedOrigins.includes(origin)) {
    throw new ApiExecutorError(
      ApiErrorCode.API_ORIGIN_MISMATCH,
      `Origin ${origin} is not in the allowed origins list.`,
    );
  }
}

export function validatePath(path: string): void {
  // Reject absolute URLs or protocol-relative paths
  if (path.startsWith('//') || path.startsWith('http://') || path.startsWith('https://')) {
    throw new ApiExecutorError(
      ApiErrorCode.API_PATH_TRAVERSAL,
      `Path must be relative. Absolute URL or protocol-relative path rejected: ${path}`,
    );
  }

  // Reject path traversal
  if (path.includes('../') || path.includes('..\\')) {
    throw new ApiExecutorError(
      ApiErrorCode.API_PATH_TRAVERSAL,
      `Path traversal detected and rejected: ${path}`,
    );
  }
}

export function validateFullUrl(
  url: URL,
  policy: NetworkPolicy,
): void {
  validateProtocol(url);
  validateHttpAllowed(url, policy);
  validateHost(url, policy);
  validateOrigin(url, policy);
}

export function buildSafeUrl(
  baseUrl: string,
  path: string,
  policy: NetworkPolicy = DEFAULT_NETWORK_POLICY,
): URL {
  validatePath(path);

  let url: URL;
  try {
    url = new URL(path, baseUrl);
  } catch {
    throw new ApiExecutorError(
      ApiErrorCode.API_UNSAFE_URL,
      `Invalid URL construction: baseUrl=${baseUrl}, path=${path}`,
    );
  }

  // Verify the origin matches the base URL origin
  const baseOrigin = new URL(baseUrl).origin;
  if (url.origin !== baseOrigin) {
    throw new ApiExecutorError(
      ApiErrorCode.API_ORIGIN_MISMATCH,
      `Constructed URL origin ${url.origin} does not match base origin ${baseOrigin}.`,
    );
  }

  validateFullUrl(url, policy);
  return url;
}

export function isPrivateHost(hostname: string): boolean {
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) return true;
  }
  return false;
}

export function isMetadataIp(hostname: string): boolean {
  return METADATA_IPS.has(hostname);
}
