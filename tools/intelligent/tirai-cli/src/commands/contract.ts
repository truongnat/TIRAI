import * as fs from 'node:fs';
import * as path from 'node:path';
import { assertValidContract } from 'contract-ir';
import { requireWorkspace } from '../workspace.js';
import { CliError } from '../errors.js';

export async function runContractValidate(opts: { cwd: string; contractPath?: string; json?: boolean }): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  const contractPath = opts.contractPath ? path.resolve(opts.cwd, opts.contractPath) : path.join(paths.artifactsDir, 'contract.json');
  if (!fs.existsSync(contractPath)) throw new CliError('CONFIG_INVALID', `Contract not found: ${contractPath}`, 'Run `tirai ingest` first.');
  let contract: unknown;
  try { contract = JSON.parse(fs.readFileSync(contractPath, 'utf8')); } catch (error) { throw new CliError('CONFIG_INVALID', `Contract is not valid JSON: ${String(error)}`); }
  try { assertValidContract(contract as Parameters<typeof assertValidContract>[0]); } catch (error) { throw new CliError('CONFIG_INVALID', error instanceof Error ? error.message : String(error)); }
  const result = { valid: true, contractPath, contractId: (contract as { contractId: string }).contractId, fingerprint: (contract as { metadata?: { contractFingerprint?: string } }).metadata?.contractFingerprint };
  if (opts.json) console.log(JSON.stringify(result, null, 2)); else console.log(`Contract valid: ${result.contractId}`);
}

export async function runContractImport(opts: { cwd: string; inputPath: string; json?: boolean }): Promise<void> {
  const paths = requireWorkspace(opts.cwd);
  const inputPath = path.resolve(opts.cwd, opts.inputPath);
  if (!fs.existsSync(inputPath)) throw new CliError('CONFIG_INVALID', `Contract not found: ${inputPath}`);
  let contract: unknown;
  try { contract = JSON.parse(fs.readFileSync(inputPath, 'utf8')); } catch (error) { throw new CliError('CONFIG_INVALID', `Contract is not valid JSON: ${String(error)}`); }
  try { assertValidContract(contract as Parameters<typeof assertValidContract>[0]); } catch (error) { throw new CliError('CONFIG_INVALID', error instanceof Error ? error.message : String(error)); }
  fs.mkdirSync(paths.artifactsDir, { recursive: true });
  const destination = path.join(paths.artifactsDir, 'contract.json');
  fs.writeFileSync(destination, `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
  const result = { imported: true, contractPath: destination, contractId: (contract as { contractId: string }).contractId, fingerprint: (contract as { metadata?: { contractFingerprint?: string } }).metadata?.contractFingerprint };
  if (opts.json) console.log(JSON.stringify(result, null, 2)); else console.log(`Contract imported: ${result.contractId}`);
}
