import { SanitizationResult } from './models.js';

const SECRET_PATTERNS = [
  /OPENAI_SECRET_SENTINEL/gi,
  /DB_PASSWORD_SENTINEL/gi,
  /AUTH_HEADER_SENTINEL/gi,
  /COOKIE_SENTINEL/gi,
  /RUNTIME_BINDING_SECRET/gi,
  /password\s*[:=]\s*['"][^'"]+['"]/gi,
  /token\s*[:=]\s*['"][^'"]+['"]/gi,
  /secret\s*[:=]\s*['"][^'"]+['"]/gi,
  /authorization\s*[:=]\s*['"][^'"]+['"]/gi,
  /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/gi,
];

const SENSITIVE_KEYS = [
  'password',
  'token',
  'secret',
  'authorization',
  'cookie',
  'api-key',
  'apikey',
  'access_token',
  'refresh_token',
];

export function sanitizePayload(payload: unknown): SanitizationResult {
  const leaksFound: string[] = [];
  let secretLeakCount = 0;

  const sanitized = deepSanitize(payload, leaksFound);

  secretLeakCount = leaksFound.length;

  return {
    sanitized,
    secretLeakCount,
    leaksFound,
  };
}

function deepSanitize(obj: unknown, leaksFound: string[]): unknown {
  if (typeof obj === 'string') {
    return sanitizeString(obj, leaksFound);
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => deepSanitize(item, leaksFound));
  }

  if (obj !== null && typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_KEYS.includes(key.toLowerCase())) {
        leaksFound.push(`Sensitive key found: ${key}`);
        sanitized[key] = '***REDACTED***';
      } else {
        sanitized[key] = deepSanitize(value, leaksFound);
      }
    }
    return sanitized;
  }

  return obj;
}

function sanitizeString(value: string, leaksFound: string[]): string {
  let sanitized = value;

  for (const pattern of SECRET_PATTERNS) {
    const matches = sanitized.match(pattern);
    if (matches) {
      for (const match of matches) {
        leaksFound.push(`Secret pattern found: ${match.slice(0, 20)}...`);
      }
      sanitized = sanitized.replace(pattern, '***REDACTED***');
    }
  }

  return sanitized;
}

export function sanitizeForJournal(entry: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(entry)) {
    if (SENSITIVE_KEYS.includes(key.toLowerCase())) {
      sanitized[key] = '***REDACTED***';
    } else if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value, []);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
