import { describe, expect, it } from 'vitest';
import {
  CONTRACT_SCHEMA_VERSION,
  finalizeContract,
  fingerprintContract,
  validateContract,
  type ContractIR,
} from '../src/index.js';

function minimalContract(): ContractIR {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    contractId: 'contract-demo',
    contractVersion: 1,
    project: { id: 'project-demo', name: 'Demo' },
    document: { title: 'Demo contract' },
    sources: [], rawContexts: [], requirements: [], businessFlows: [], ui: [], apis: [],
    entities: [], modules: [], scenarios: [], testCases: [], artifacts: [], unresolved: [], conflicts: [],
    quality: { requirements: 0, requirementsCovered: 0, scenarios: 0, testCases: 0, automationReady: 0, unresolved: 0, conflicts: 0, provenanceCoverage: 1 },
    metadata: { contractFingerprint: 'pending', generatedAt: '2026-01-01T00:00:00.000Z', generatorVersion: 'test', promptVersions: [] },
  };
}

describe('Contract IR', () => {
  it('validates the versioned top-level contract', () => {
    expect(validateContract(minimalContract())).toEqual({ valid: true, errors: [] });
  });

  it('rejects duplicate node ids and stale quality counts', () => {
    const contract = minimalContract();
    contract.requirements = [{ id: 'REQ-1', kind: 'requirement', title: 'A', relatedIds: [], provenance: [], confidence: 1, type: 'functional', statement: 'A', preconditions: [], acceptanceCriteria: [], constraints: [], testability: 'testable' }];
    contract.scenarios = [{ id: 'REQ-1', kind: 'scenario', title: 'B', relatedIds: [], provenance: [], confidence: 1, requirementIds: [], category: 'happy-path', preconditions: [], expectedBehaviors: [] }];
    expect(validateContract(contract).errors).toEqual(expect.arrayContaining(['/nodes/REQ-1 duplicate id', '/quality/requirements does not match requirements length']));
  });

  it('fingerprints canonically and ignores generated metadata', () => {
    const first = finalizeContract(minimalContract());
    const second = finalizeContract({ ...minimalContract(), metadata: { ...minimalContract().metadata, generatedAt: '2027-01-01T00:00:00.000Z' } });
    expect(first.metadata.contractFingerprint).toBe(fingerprintContract(first));
    expect(first.metadata.contractFingerprint).toBe(second.metadata.contractFingerprint);
  });

  it('rejects content modified after fingerprinting', () => {
    const contract = finalizeContract(minimalContract());
    contract.document.title = 'Tampered contract';
    expect(validateContract(contract).errors).toContain('/metadata/contractFingerprint does not match contract content');
  });
});
