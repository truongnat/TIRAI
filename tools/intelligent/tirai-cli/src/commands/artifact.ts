import * as fs from 'node:fs';
import * as path from 'node:path';
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
