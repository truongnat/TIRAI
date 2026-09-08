import * as fs from 'node:fs';
import * as path from 'node:path';
import { requireWorkspace } from '../workspace.js';
import { CliError } from '../errors.js';

export async function runAnalyze(opts: { cwd: string; json?: boolean }): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  const inputPath = path.join(paths.artifactsDir, 'ai-input.json');
  const rawManifestPath = path.join(paths.artifactsDir, 'raw-context', 'manifest.json');
  if (!fs.existsSync(inputPath) || !fs.existsSync(rawManifestPath)) throw new CliError('CONFIG_INVALID', 'AI input package not found. Run `tirai ingest` first.');
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as { contexts?: unknown[]; artifacts?: unknown[]; policy?: unknown };
  const manifest = JSON.parse(fs.readFileSync(rawManifestPath, 'utf8')) as { stats?: unknown; modules?: unknown[] };
  const result = { inputPath, rawManifestPath, contextCount: input.contexts?.length ?? 0, artifactCount: input.artifacts?.length ?? 0, moduleCount: manifest.modules?.length ?? 0, policy: input.policy };
  if (opts.json) console.log(JSON.stringify(result, null, 2)); else console.log(`AI input ready: ${result.contextCount} contexts, ${result.artifactCount} source artifacts, ${result.moduleCount} modules`);
}
