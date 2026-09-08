import { createHash } from 'node:crypto';
import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js';
import { contractIRSchema } from './schema.js';
import type { ContractIR } from './models.js';

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateSchema = ajv.compile(contractIRSchema);

export interface ContractValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateContract(input: unknown): ContractValidationResult {
  const errors: string[] = [];
  if (!validateSchema(input)) {
    errors.push(...(validateSchema.errors ?? []).map(formatAjvError));
  }
  if (input && typeof input === 'object') {
    const contract = input as Partial<ContractIR>;
    errors.push(...validateUniqueIds(contract));
    errors.push(...validateReferences(contract));
    errors.push(...validateQuality(contract));
    if (typeof contract.metadata?.contractFingerprint === 'string' && contract.metadata.contractFingerprint !== 'pending') {
      const expected = fingerprintContract(contract as ContractIR);
      if (contract.metadata.contractFingerprint !== expected) errors.push('/metadata/contractFingerprint does not match contract content');
    }
  }
  return { valid: errors.length === 0, errors };
}

export function assertValidContract(input: unknown): asserts input is ContractIR {
  const result = validateContract(input);
  if (!result.valid) throw new Error(`Invalid Contract IR: ${result.errors.join('; ')}`);
}

export function stableContractStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableContractStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableContractStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function fingerprintContract(input: ContractIR): string {
  const copy = JSON.parse(JSON.stringify(input)) as ContractIR;
  const metadata = copy.metadata as unknown as Record<string, unknown>;
  delete metadata.contractFingerprint;
  delete metadata.generatedAt;
  return createHash('sha256').update(stableContractStringify(copy)).digest('hex');
}

export function finalizeContract(input: ContractIR): ContractIR {
  const contract = structuredClone(input);
  contract.metadata.contractFingerprint = fingerprintContract(contract);
  return contract;
}

export function upgradeContract(input: unknown): ContractIR {
  assertValidContract(input);
  return structuredClone(input);
}

function formatAjvError(error: ErrorObject): string {
  return `${error.instancePath || '/'} ${error.message ?? 'schema violation'}`;
}

function allNodes(contract: Partial<ContractIR>): Array<{ id?: string; relatedIds?: string[] }> {
  return [
    ...(contract.requirements ?? []), ...(contract.businessFlows ?? []), ...(contract.ui ?? []),
    ...(contract.apis ?? []), ...(contract.entities ?? []), ...(contract.modules ?? []),
    ...(contract.scenarios ?? []), ...(contract.testCases ?? []), ...(contract.artifacts ?? []),
  ];
}

function validateUniqueIds(contract: Partial<ContractIR>): string[] {
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const node of allNodes(contract)) {
    if (!node.id) continue;
    if (seen.has(node.id)) errors.push(`/nodes/${node.id} duplicate id`);
    seen.add(node.id);
  }
  return errors;
}

function validateReferences(contract: Partial<ContractIR>): string[] {
  const ids = new Set(allNodes(contract).flatMap((node) => node.id ? [node.id] : []));
  const errors: string[] = [];
  for (const node of allNodes(contract)) {
    for (const relatedId of node.relatedIds ?? []) {
      if (!ids.has(relatedId)) errors.push(`/nodes/${node.id ?? 'unknown'}/relatedIds references missing ${relatedId}`);
    }
  }
  return errors;
}

function validateQuality(contract: Partial<ContractIR>): string[] {
  const quality = contract.quality;
  if (!quality) return [];
  const errors: string[] = [];
  if (quality.requirements !== (contract.requirements?.length ?? 0)) errors.push('/quality/requirements does not match requirements length');
  if (quality.scenarios !== (contract.scenarios?.length ?? 0)) errors.push('/quality/scenarios does not match scenarios length');
  if (quality.testCases !== (contract.testCases?.length ?? 0)) errors.push('/quality/testCases does not match testCases length');
  if (quality.unresolved !== (contract.unresolved?.length ?? 0)) errors.push('/quality/unresolved does not match unresolved length');
  if (quality.conflicts !== (contract.conflicts?.length ?? 0)) errors.push('/quality/conflicts does not match conflicts length');
  return errors;
}
