import { createHash } from 'node:crypto';

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function stableId(prefix: string, value: string): string {
  return `${prefix}-${sha256(value).slice(0, 24)}`;
}

export function locationKey(location: { segments: Array<{ kind: string; value: string | number }> }): string {
  return location.segments.map((segment) => `${segment.kind}=${String(segment.value)}`).join('/');
}
