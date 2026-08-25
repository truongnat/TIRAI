import { createHash } from 'node:crypto';

import type { SourceLocation } from './models.js';

export function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export function stableId(prefix: string, value: string): string {
  return `${prefix}_${sha256(value).slice(0, 24)}`;
}

export function locationKey(location: SourceLocation): string {
  return location.segments.map((segment) => `${segment.kind}=${String(segment.value)}`).join('/');
}
