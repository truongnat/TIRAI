import {
  finalizeContract,
  assertValidContract,
  type ContractIR,
  type ContractProvenance,
} from 'contract-ir';
import type { CanonicalSourceDocument } from 'source-ingestion';
import type { SemanticIR } from 'semantic-analyzer';
import type { RequirementIR } from 'requirement-builder';
import type { TestPlanIR } from 'test-planner';

/** Build the central Contract IR from the existing stage IRs. */
export function buildContractIR(input: {
  document: CanonicalSourceDocument;
  semanticIR: SemanticIR;
  requirementIR: RequirementIR;
  testPlanIR: TestPlanIR;
  project?: { id: string; name: string; profileFingerprint?: string };
}): ContractIR {
  const { document, semanticIR, requirementIR, testPlanIR } = input;
  const sourceId = document.source.id;
  const provenance = (value: { contextId: string; sheet?: string; ranges?: string[]; cells?: string[] }): ContractProvenance[] => [{
    sourceId,
    contextId: value.contextId,
    ...(value.sheet ? { sheet: value.sheet } : {}),
    ...(value.ranges ? { ranges: value.ranges } : {}),
    ...(value.cells ? { cells: value.cells } : {}),
  }];
  const nodeProvenance = (items: Array<{ contextId?: string; sheet?: string; ranges?: string[]; cells?: string[] }> | undefined) =>
    (items ?? []).filter((item): item is { contextId: string; sheet?: string; ranges?: string[]; cells?: string[] } => Boolean(item.contextId)).flatMap(provenance);

  const businessFlows = semanticIR.flows.map((flow) => ({
    id: flow.id,
    kind: 'business-flow' as const,
    title: flow.name,
    description: flow.description,
    relatedIds: [],
    provenance: nodeProvenance(flow.provenance),
    confidence: flow.confidence,
    steps: flow.steps.map((step) => step.action),
    inputs: flow.steps.flatMap((step) => step.target ? [step.target] : []),
    outputs: flow.postconditions ?? [],
    branches: flow.steps.flatMap((step) => step.condition ? [step.condition] : []),
  }));

  const requirements = requirementIR.requirements.map((requirement) => ({
    id: requirement.id,
    kind: 'requirement' as const,
    title: requirement.title,
    description: requirement.statement,
    relatedIds: requirement.relatedSemanticIds.filter((id) => businessFlows.some((flow) => flow.id === id)),
    provenance: nodeProvenance(requirement.provenance),
    confidence: requirement.confidence,
    type: requirement.type,
    statement: requirement.statement,
    ...(requirement.actor ? { actor: requirement.actor } : {}),
    ...(requirement.trigger ? { trigger: requirement.trigger } : {}),
    preconditions: requirement.preconditions.map((item) => item.description),
    acceptanceCriteria: requirement.expectedBehaviors.map((item) => item.description),
    constraints: requirement.constraints.map((item) => item.description),
    testability: requirement.testability.status,
  }));

  const scenarios = testPlanIR.scenarios.map((scenario) => ({
    id: scenario.id,
    kind: 'scenario' as const,
    title: scenario.title,
    description: scenario.objective,
    relatedIds: scenario.requirementIds,
    provenance: nodeProvenance(scenario.provenance),
    confidence: scenario.confidence,
    requirementIds: scenario.requirementIds,
    category: scenario.category,
    preconditions: scenario.preconditions.map((item) => item.description),
    expectedBehaviors: scenario.expectedBehavior,
  }));

  const testCases = testPlanIR.testCases.map((testCase) => ({
    id: testCase.id,
    kind: 'test-case' as const,
    title: testCase.title,
    description: testCase.objective,
    relatedIds: [testCase.scenarioId, ...testCase.requirementIds],
    provenance: nodeProvenance(testCase.provenance),
    confidence: testCase.confidence,
    scenarioId: testCase.scenarioId,
    requirementIds: testCase.requirementIds,
    executor: executorFor(testCase.type),
    priority: testCase.priority,
    preconditions: testCase.preconditions.map((item) => item.description),
    dataNeeds: testCase.dataNeeds.map((item) => item.description),
    steps: testCase.steps.map((step) => ({ order: step.order, action: step.action, ...(step.target ? { target: step.target } : {}), ...(step.input ? { input: step.input } : {}) })),
    assertions: testCase.expectedResults.map((result) => ({ description: result.description, type: result.verificationType, ...(result.target ? { target: result.target } : {}), ...(result.verificationIntent?.expectedValue !== undefined ? { expected: result.verificationIntent.expectedValue } : {}) })),
    cleanup: testCase.cleanup.map((item) => item.description),
    automation: testCase.automation.status,
  }));
  const apiNeeds = testPlanIR.testCases.flatMap((testCase) => testCase.dataNeeds
    .filter((need) => need.type === 'external-response')
    .map((need) => ({ testCase, need })));
  const apis = [...new Map(apiNeeds.map(({ testCase, need }, index) => {
    const key = need.description.trim().toLowerCase();
    return [`api-${key || index}`, {
      id: `api-${key ? key.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) : index}`,
      kind: 'api' as const,
      title: need.description,
      description: `API requirement referenced by ${testCase.id}.`,
      relatedIds: [testCase.id, ...testCase.requirementIds],
      provenance: nodeProvenance(need.provenance),
      confidence: 0.5,
      method: 'UNKNOWN',
      endpoint: need.description,
      errorResponses: [],
    }];
  })).values()];

  const rawContexts = document.contexts.map((context) => ({
    id: context.id,
    sourceId,
    ...(context.metadata?.sheetName ? { title: String(context.metadata.sheetName) } : {}),
    kind: context.type as 'document',
    ...(context.parentContextId ? { parentContextId: context.parentContextId } : {}),
    contentHash: context.contentHash,
    ...(context.metadata?.range ? { locator: String(context.metadata.range) } : {}),
    content: context.content,
    provenance: [{ sourceId, contextId: context.id }],
  }));
  const moduleNames = [...new Set(document.contexts.map((context) => String(context.metadata?.module ?? context.metadata?.feature ?? context.metadata?.sheetName ?? 'ungrouped')))].sort();
  const modules = moduleNames.map((name) => {
    const contextIds = document.contexts.filter((context) => String(context.metadata?.module ?? context.metadata?.feature ?? context.metadata?.sheetName ?? 'ungrouped') === name).map((context) => context.id);
    const relatedIds = requirements.filter((requirement) => requirement.provenance.some((item) => item.contextId && contextIds.includes(item.contextId))).map((requirement) => requirement.id);
    const slug = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unnamed';
    return { id: `module-${slug}`, kind: 'module' as const, title: name, description: `Module inferred from source context metadata: ${name}`, relatedIds, provenance: contextIds.map((contextId) => ({ sourceId, contextId })), confidence: 0.7, sourceFiles: [], dependencies: [], state: [] };
  });
  const traceableNodes = [...requirements, ...scenarios, ...testCases];
  const provenanceCoverage = traceableNodes.length === 0
    ? 0
    : traceableNodes.filter((node) => node.provenance.length > 0).length / traceableNodes.length;
  const requiredBehaviorDimensions = ['happy-path', 'negative', 'boundary', 'validation', 'empty', 'loading', 'error', 'permission', 'state-transition', 'retry', 'rollback'];
  const coveredBehaviorDimensions = new Set<string>(testPlanIR.scenarios.map((scenario) => scenario.category));
  const behaviorGaps = requiredBehaviorDimensions.filter((dimension) => !coveredBehaviorDimensions.has(dimension));

  const contract: ContractIR = {
    schemaVersion: '1.0',
    contractId: `contract-${document.revision.contentHash.slice(0, 16)}`,
    contractVersion: 1,
    project: input.project ?? { id: 'unconfigured-project', name: 'Unconfigured project' },
    document: { title: semanticIR.document.title ?? document.source.displayName, ...(semanticIR.document.summary ? { summary: semanticIR.document.summary } : {}), ...(semanticIR.document.language ? { language: semanticIR.document.language } : {}) },
    sources: [{ id: sourceId, kind: sourceKind(document.source.kind), displayName: document.source.displayName, contentHash: document.revision.contentHash, provenance: [{ sourceId }] }],
    rawContexts,
    requirements,
    businessFlows,
    ui: [],
    apis,
    entities: semanticIR.entities.map((entity) => ({ id: entity.id, kind: 'entity' as const, title: entity.name, description: entity.description, relatedIds: [], provenance: nodeProvenance(entity.provenance), confidence: entity.confidence, attributes: (entity.attributes ?? []).map((attribute) => ({ name: attribute.name, ...(attribute.dataType ? { dataType: attribute.dataType } : {}), constraints: [] })) })),
    modules,
    scenarios,
    testCases,
    artifacts: [],
    unresolved: [
      ...semanticIR.unresolved,
      ...requirementIR.unresolved,
      ...testPlanIR.unresolved,
      ...behaviorGaps.map((dimension) => ({ id: `UNRESOLVED-BEHAVIOR-${dimension.toUpperCase()}`, description: `No ${dimension} behavior scenario was generated.`, reason: 'The supplied requirements and source evidence did not establish this behavior dimension.', provenance: [] })),
    ].map((item, index) => ({ id: item.id || `UNRESOLVED-${index + 1}`, description: item.description, reason: item.reason, relatedIds: [], provenance: nodeProvenance(item.provenance), confidence: 0 })),
    conflicts: requirementIR.conflicts.map((item) => ({ id: item.id, description: item.description, type: item.type, relatedIds: item.requirementIds, provenance: nodeProvenance(item.provenance), confidence: item.confidence })),
    quality: {
      requirements: requirements.length,
      requirementsCovered: testPlanIR.quality.requirementsCovered,
      scenarios: scenarios.length,
      testCases: testCases.length,
      automationReady: testCases.filter((item) => item.automation === 'ready').length,
      unresolved: 0,
      conflicts: 0,
      provenanceCoverage,
    },
    metadata: {
      contractFingerprint: 'pending',
      generatedAt: new Date().toISOString(),
      generatorVersion: 'contract-ir-1.0.0',
      aiProvider: semanticIR.analysis.provider,
      aiModel: semanticIR.analysis.model,
      promptVersions: [semanticIR.analysis.promptVersion],
    },
  };
  contract.quality.unresolved = contract.unresolved.length;
  contract.quality.conflicts = contract.conflicts.length;
  const finalized = finalizeContract(contract);
  assertValidContract(finalized);
  return finalized;
}

function sourceKind(kind: string): ContractIR['sources'][number]['kind'] {
  return ['excel', 'pdf', 'docx', 'markdown', 'html', 'json', 'csv', 'url', 'source-code'].includes(kind)
    ? kind as ContractIR['sources'][number]['kind']
    : 'other';
}

function executorFor(type: string): ContractIR['testCases'][number]['executor'] {
  if (type === 'ui') return 'playwright';
  if (type === 'api') return 'api';
  if (type === 'database') return 'database';
  if (type === 'integration') return 'hybrid';
  if (type === 'manual') return 'manual';
  return 'unit';
}
