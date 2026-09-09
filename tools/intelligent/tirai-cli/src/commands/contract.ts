import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { assertValidContract, finalizeContract, type ContractIR } from 'contract-ir';
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
  const canonicalContract = finalizeContract(contract as ContractIR);
  fs.mkdirSync(paths.artifactsDir, { recursive: true });
  const destination = path.join(paths.artifactsDir, 'contract.json');
  fs.writeFileSync(destination, `${JSON.stringify(canonicalContract, null, 2)}\n`, 'utf8');
  const importAudit = {
    schemaVersion: '1.0',
    inputPath,
    inputSha256: createHash('sha256').update(fs.readFileSync(inputPath)).digest('hex'),
    importedAt: new Date().toISOString(),
    contractId: canonicalContract.contractId,
    inputFingerprint: (contract as { metadata?: { contractFingerprint?: string } }).metadata?.contractFingerprint ?? null,
    canonicalFingerprint: canonicalContract.metadata.contractFingerprint,
  };
  const auditPath = path.join(paths.artifactsDir, 'contract-import.json');
  fs.writeFileSync(auditPath, `${JSON.stringify(importAudit, null, 2)}\n`, 'utf8');
  const result = { imported: true, contractPath: destination, auditPath, contractId: canonicalContract.contractId, fingerprint: canonicalContract.metadata.contractFingerprint };
  if (opts.json) console.log(JSON.stringify(result, null, 2)); else console.log(`Contract imported: ${result.contractId}`);
}
