import type { ContractIR, ContractArtifact } from 'contract-ir';

export interface ArtifactPlan { schemaVersion: '1.0'; contractId: string; contractFingerprint: string; strategy: 'single' | 'by-module'; artifacts: ContractArtifact[]; }

export function planArtifacts(contract: ContractIR): ArtifactPlan {
  const modules = contract.modules.map((module) => module.id);
  const strategy = modules.length > 1 ? 'by-module' : 'single';
  const types: ContractArtifact['artifactType'][] = ['json', 'excel', 'markdown', 'playwright', 'unit', 'api', 'database', 'report'];
  const contractNodeIds = [
    ...contract.requirements.map((node) => node.id),
    ...contract.businessFlows.map((node) => node.id),
    ...contract.scenarios.map((node) => node.id),
    ...contract.testCases.map((node) => node.id),
  ];
  const sourceProvenance = contract.sources.map((source) => ({ sourceId: source.id }));
  const plannedModules = strategy === 'by-module' ? modules : [undefined];
  const artifacts = plannedModules.flatMap((module) => types.map((artifactType) => {
    const suffix = module ? `-${module}` : '';
    return {
      id: `artifact-${artifactType}${suffix}`, kind: 'artifact' as const, name: `${artifactType} output${module ? ` (${module})` : ''}`, title: `${artifactType} output${module ? ` (${module})` : ''}`, artifactType,
      path: `outputs/${module ? `${module}/` : ''}${artifactType}`, ...(module ? { module } : {}),
      dependsOn: artifactType === 'report' ? [`artifact-json${suffix}`] : [], contractIds: contractNodeIds, relatedIds: contractNodeIds, provenance: sourceProvenance, confidence: 1, status: 'planned' as const,
    };
  }));
  return { schemaVersion: '1.0', contractId: contract.contractId, contractFingerprint: contract.metadata.contractFingerprint, strategy, artifacts };
}
