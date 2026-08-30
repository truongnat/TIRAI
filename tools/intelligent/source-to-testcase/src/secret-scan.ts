// Lightweight secret-leak scanner for persisted acceptance artifacts.
// Matches common credential shapes; intentionally conservative so it does
// not false-positive on the synthetic business data used by the harness.

import * as fs from 'node:fs';

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'openai-key', re: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/ },
  { name: 'aws-key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'generic-token', re: /(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"]?[A-Za-z0-9/+]{16,}/i },
  { name: 'bearer', re: /Bearer\s+[A-Za-z0-9._-]{16,}/ },
];

export function scanSecrets(files: string[]): number {
  let count = 0;
  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const { re } of PATTERNS) {
      if (re.test(content)) count++;
    }
  }
  return count;
}
