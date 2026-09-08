import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { planArtifacts } from 'source-to-testcase';
import type { ContractIR } from 'contract-ir';
import { requireWorkspace } from '../workspace.js';
import { CliError } from '../errors.js';

export async function runArtifactPlan(opts: { cwd: string; contractPath?: string; json?: boolean }): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  const contractPath = opts.contractPath ? path.resolve(opts.cwd, opts.contractPath) : path.join(paths.artifactsDir, 'contract.json');
  if (!fs.existsSync(contractPath)) throw new CliError('CONFIG_INVALID', `Contract not found: ${contractPath}`);
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8')) as ContractIR;
  const plan = planArtifacts(contract);
  const outputPath = path.join(paths.artifactsDir, 'artifact-plan.json');
  fs.writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  if (opts.json) console.log(JSON.stringify({ ...plan, path: outputPath }, null, 2)); else console.log(`Artifact plan written: ${path.relative(paths.root, outputPath)} (${plan.strategy})`);
}

export async function runArtifactVerify(opts: { cwd: string; json?: boolean }): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  const manifestPath = path.join(paths.artifactsDir, 'export-manifest.json');
  if (!fs.existsSync(manifestPath)) throw new CliError('CONFIG_INVALID', 'Export manifest not found. Run `tirai export` first.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { artifacts?: Array<{ path: string; contentHash: string }> };
  const checks = (manifest.artifacts ?? []).map((artifact) => {
    const absolutePath = path.resolve(paths.root, artifact.path);
    const exists = fs.existsSync(absolutePath);
    const actualHash = exists ? createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex') : undefined;
    return { path: artifact.path, exists, valid: exists && actualHash === artifact.contentHash, expectedHash: artifact.contentHash, actualHash };
  });
  const valid = checks.length > 0 && checks.every((check) => check.valid);
  const result = { valid, manifestPath, contractId: (manifest as { contractId?: string }).contractId, checks };
  if (!valid) throw new CliError('CONFIG_INVALID', `Export manifest verification failed: ${checks.filter((check) => !check.valid).map((check) => path.basename(check.path)).join(', ')}`);
  if (opts.json) console.log(JSON.stringify(result, null, 2)); else console.log(`Artifact manifest valid: ${checks.length} file(s)`);
}
