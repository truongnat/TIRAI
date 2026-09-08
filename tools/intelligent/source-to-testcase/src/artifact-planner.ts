import type { ContractIR, ContractArtifact } from 'contract-ir';

export interface ArtifactPlan { schemaVersion: '1.0'; contractId: string; strategy: 'single' | 'by-module'; artifacts: ContractArtifact[]; }

export function planArtifacts(contract: ContractIR): ArtifactPlan {
  const modules = contract.modules.map((module) => module.id);
  const strategy = modules.length > 1 ? 'by-module' : 'single';
  const types: ContractArtifact['artifactType'][] = ['json', 'excel', 'markdown', 'playwright', 'unit', 'report'];
  const artifacts = types.map((artifactType) => ({
    id: `artifact-${artifactType}`, kind: 'artifact' as const, name: `${artifactType} output`, title: `${artifactType} output`, artifactType,
    path: `outputs/${strategy === 'by-module' ? '{module}/' : ''}${artifactType}`, module: strategy === 'by-module' ? '{module}' : undefined,
    dependsOn: [], contractIds: contract.testCases.map((tc) => tc.id), relatedIds: contract.testCases.map((tc) => tc.id), provenance: [], confidence: 1, status: 'planned' as const,
  }));
  return { schemaVersion: '1.0', contractId: contract.contractId, strategy, artifacts };
}
