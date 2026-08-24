import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import type { BenchmarkInput, BenchmarkInputFingerprint } from './models.js';
export async function fingerprintInput(input: BenchmarkInput): Promise<BenchmarkInputFingerprint> {
  const stat = statSync(input.path); const hash = createHash('sha256');
  await new Promise<void>((resolve,reject) => { const stream = createReadStream(input.path); stream.on('data', chunk => hash.update(chunk)); stream.on('end', () => resolve()); stream.on('error', reject); });
  return { ...input, sizeBytes: stat.size, sha256: hash.digest('hex') };
}
export async function fingerprintInputs(inputs: BenchmarkInput[]): Promise<BenchmarkInputFingerprint[]> { return Promise.all(inputs.map(fingerprintInput)); }
