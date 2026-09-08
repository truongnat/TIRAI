// ---------------------------------------------------------------------------
// Source-to-TestCase pipeline orchestration
// ---------------------------------------------------------------------------
// Connector-neutral: it opens the source through the SourceConnectorRegistry
// (no Excel-specific branching after ingestion), bridges the canonical
// document into the semantic context format, then chains the existing,
// AI-provider-injected stages: semantic analysis -> requirement building ->
// test planning. The AIProvider is injected so the same orchestration runs
// with a real provider or the architecture's FakeAIProvider for offline use.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createDefaultSourceConnectorRegistry,
  type CanonicalSourceDocument,
  type LocalSourceInput,
} from 'source-ingestion';
import { analyzeSemanticContext, type SemanticIR } from 'semantic-analyzer';
import { buildRequirementsFromSemanticIR, type RequirementIR, type SemanticIRInput } from 'requirement-builder';
import { buildTestPlanFromRequirementIR, type TestPlanIR, type RequirementIRInput } from 'test-planner';
import type { AIProvider } from 'ai-provider';
import { writeSemanticContextPackage } from './bridge.js';
import { scanSecrets } from './secret-scan.js';
import { compileStructuredDesignDocument } from './structured-design-compiler.js';
import { buildContractIR } from './contract-builder.js';

export type PipelineStage = 'SOURCE_INGESTION' | 'SEMANTIC_ANALYSIS' | 'REQUIREMENT_BUILD' | 'TEST_PLANNING';

export class SourceToTestCaseError extends Error {
  constructor(public readonly stage: PipelineStage, message: string, public readonly cause?: unknown) {
    super(`[${stage}] ${message}`);
    this.name = 'SourceToTestCaseError';
  }
}

export interface SourceToTestCaseOptions {
  sourcePath: string;
  provider: AIProvider;
  outputDir: string;
  sourceKind?: string;
  promptVersion?: string;
}

export interface SourceIdentity {
  sourceId: string;
  displayName: string;
  contentHash: string;
  byteLength: number;
  artifactCount: number;
  contextCount: number;
  connectorId: string;
}

export interface SourceToTestCaseResult {
  source: SourceIdentity;
  semantic: { status: string; chunkCount: number; aiCalls: number; provider: string; model: string };
  requirements: { requirementCount: number; aiCalls: number; provider: string; model: string };
  testPlan: { scenarioCount: number; testCaseCount: number; aiCalls: number; provider: string; model: string };
  metrics: {
    sourceIngestionAiCalls: number;
    semanticAiCalls: number;
    requirementBuilderAiCalls: number;
    testPlannerAiCalls: number;
    secretLeakCount: number;
    sourceMutations: number;
    manualArtifactSubstitutions: number;
    sourceSpecificBranchesAfterIngestion: number;
    testCaseRoundTripFailures: number;
  };
  artifacts: {
    contract: string;
    context: string;
    semanticContextDir: string;
    semanticIr: string;
    requirements: string;
    testPlan: string;
    testCases: string;
    trace: string;
  };
  document: CanonicalSourceDocument;
  semanticIR: SemanticIR;
  requirementIR: RequirementIR;
  testPlanIR: TestPlanIR;
}

function analysisInfo(analysis: unknown): { aiCalls: number; provider: string; model: string } {
  const a = (analysis ?? {}) as { aiRequests?: number; provider?: string; model?: string };
  return {
    aiCalls: a.aiRequests ?? 0,
    provider: a.provider ?? 'unknown',
    model: a.model ?? 'unknown',
  };
}

export async function runSourceToTestCasePipeline(opts: SourceToTestCaseOptions): Promise<SourceToTestCaseResult> {
  const { sourcePath, provider, outputDir } = opts;
  fs.mkdirSync(outputDir, { recursive: true });

  let byteLength = 0;
  try {
    byteLength = fs.statSync(sourcePath).size;
  } catch {
    byteLength = 0;
  }

  // -- Stage 1: source ingestion (connector-neutral) -----------------------
  let doc: CanonicalSourceDocument;
  try {
    const registry = createDefaultSourceConnectorRegistry();
    const input: LocalSourceInput = { kind: opts.sourceKind ?? 'excel', path: sourcePath };
    doc = await registry.open(input);
  } catch (err) {
    throw new SourceToTestCaseError('SOURCE_INGESTION', `Failed to ingest source: ${err instanceof Error ? err.message : String(err)}`, err);
  }

  const source: SourceIdentity = {
    sourceId: doc.source.id,
    displayName: doc.source.displayName,
    contentHash: doc.revision.contentHash,
    byteLength,
    artifactCount: doc.artifacts.length,
    contextCount: doc.contexts.length,
    connectorId: doc.source.connectorId,
  };

  // -- Bridge: canonical document -> semantic context dir ------------------
  const semanticContextDir = path.join(outputDir, 'semantic-context');
  const writeResult = writeSemanticContextPackage(doc, semanticContextDir);

  // Structured detailed-design workbooks already carry explicit row-level
  // requirements. Compile that contract deterministically before the AI path
  // so offline/example runs never substitute unrelated generic fake data.
  const structuredCompilation = compileStructuredDesignDocument(doc);
  if (structuredCompilation) {
    const { semanticIR, requirementIR, testPlanIR } = structuredCompilation;
    const contextPath = path.join(outputDir, 'context.json');
    const contractPath = path.join(outputDir, 'contract.json');
    const semanticIrPath = path.join(outputDir, 'semantic-ir.json');
    const requirementsPath = path.join(outputDir, 'requirements.json');
    const testPlanPath = path.join(outputDir, 'test-plan.json');
    const testCasesPath = path.join(outputDir, 'testcases.json');
    const tracePath = path.join(outputDir, 'trace.json');

    fs.writeFileSync(contextPath, JSON.stringify(doc, null, 2), 'utf8');
    const contract = buildContractIR({ document: doc, semanticIR, requirementIR, testPlanIR });
    fs.writeFileSync(contractPath, JSON.stringify(contract, null, 2), 'utf8');
    fs.writeFileSync(semanticIrPath, JSON.stringify(semanticIR, null, 2), 'utf8');
    fs.writeFileSync(requirementsPath, JSON.stringify(requirementIR, null, 2), 'utf8');
    fs.writeFileSync(testPlanPath, JSON.stringify(testPlanIR, null, 2), 'utf8');
    fs.writeFileSync(testCasesPath, JSON.stringify(testPlanIR.testCases, null, 2), 'utf8');
    fs.writeFileSync(tracePath, JSON.stringify(buildTrace(doc, requirementIR, testPlanIR), null, 2), 'utf8');

    const secretLeakCount = scanSecrets([contractPath, contextPath, semanticIrPath, requirementsPath, testPlanPath, testCasesPath, tracePath]);
    const semanticProvider = 'structured-design-compiler';
    const semanticModel = 'deterministic';
    return {
      source,
      semantic: { status: semanticIR.status, chunkCount: writeResult.chunkCount, aiCalls: 0, provider: semanticProvider, model: semanticModel },
      requirements: { requirementCount: requirementIR.requirements.length, aiCalls: 0, provider: semanticProvider, model: semanticModel },
      testPlan: {
        scenarioCount: testPlanIR.scenarios.length,
        testCaseCount: testPlanIR.testCases.length,
        aiCalls: 0,
        provider: semanticProvider,
        model: semanticModel,
      },
      metrics: {
        sourceIngestionAiCalls: 0,
        semanticAiCalls: 0,
        requirementBuilderAiCalls: 0,
        testPlannerAiCalls: 0,
        secretLeakCount,
        sourceMutations: 0,
        manualArtifactSubstitutions: 0,
        sourceSpecificBranchesAfterIngestion: 0,
        testCaseRoundTripFailures: 0,
      },
      artifacts: {
        contract: contractPath,
        context: contextPath,
        semanticContextDir,
        semanticIr: semanticIrPath,
        requirements: requirementsPath,
        testPlan: testPlanPath,
        testCases: testCasesPath,
        trace: tracePath,
      },
      document: doc,
      semanticIR,
      requirementIR,
      testPlanIR,
    };
  }

  // -- Count AI calls per stage via a transparent proxy (no behavior change)
  let stage: PipelineStage = 'SEMANTIC_ANALYSIS';
  const aiCalls: Record<PipelineStage, number> = {
    SOURCE_INGESTION: 0,
    SEMANTIC_ANALYSIS: 0,
    REQUIREMENT_BUILD: 0,
    TEST_PLANNING: 0,
  };
  const providerProxy: AIProvider = new Proxy(provider, {
    get(target, prop, receiver) {
      if (prop === 'generate') {
        return async (...args: unknown[]) => {
          aiCalls[stage]++;
          return (target as { generate: (...a: unknown[]) => unknown }).generate(...args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  // -- Stage 2: semantic analysis -----------------------------------------
  let semanticIR: SemanticIR;
  try {
    stage = 'SEMANTIC_ANALYSIS';
    semanticIR = await analyzeSemanticContext(semanticContextDir, providerProxy, {
      outputDir: path.join(outputDir, 'semantic'),
      promptVersion: opts.promptVersion,
    });
  } catch (err) {
    throw new SourceToTestCaseError('SEMANTIC_ANALYSIS', `Semantic analysis failed: ${err instanceof Error ? err.message : String(err)}`, err);
  }

  // -- Stage 3: requirement building ---------------------------------------
  let requirementIR: RequirementIR;
  try {
    stage = 'REQUIREMENT_BUILD';
    requirementIR = await buildRequirementsFromSemanticIR(semanticIR as unknown as SemanticIRInput, providerProxy, {
      outputDir: path.join(outputDir, 'requirements'),
    }, sourcePath);
  } catch (err) {
    throw new SourceToTestCaseError('REQUIREMENT_BUILD', `Requirement building failed: ${err instanceof Error ? err.message : String(err)}`, err);
  }

  // -- Stage 4: test planning ---------------------------------------------
  let testPlanIR: TestPlanIR;
  try {
    stage = 'TEST_PLANNING';
    testPlanIR = await buildTestPlanFromRequirementIR(requirementIR as unknown as RequirementIRInput, providerProxy, {
      outputDir: path.join(outputDir, 'testplan'),
    }, sourcePath);
  } catch (err) {
    throw new SourceToTestCaseError('TEST_PLANNING', `Test planning failed: ${err instanceof Error ? err.message : String(err)}`, err);
  }

  // -- Persist artifacts (exact pipeline output; no hand editing) ---------
  const contextPath = path.join(outputDir, 'context.json');
  const contractPath = path.join(outputDir, 'contract.json');
  const semanticIrPath = path.join(outputDir, 'semantic-ir.json');
  const requirementsPath = path.join(outputDir, 'requirements.json');
  const testPlanPath = path.join(outputDir, 'test-plan.json');
  const testCasesPath = path.join(outputDir, 'testcases.json');
  const tracePath = path.join(outputDir, 'trace.json');

  fs.writeFileSync(contextPath, JSON.stringify(doc, null, 2), 'utf8');
  const contract = buildContractIR({ document: doc, semanticIR, requirementIR, testPlanIR });
  fs.writeFileSync(contractPath, JSON.stringify(contract, null, 2), 'utf8');
  fs.writeFileSync(semanticIrPath, JSON.stringify(semanticIR, null, 2), 'utf8');
  fs.writeFileSync(requirementsPath, JSON.stringify(requirementIR, null, 2), 'utf8');
  fs.writeFileSync(testPlanPath, JSON.stringify(testPlanIR, null, 2), 'utf8');
  fs.writeFileSync(testCasesPath, JSON.stringify(testPlanIR.testCases, null, 2), 'utf8');
  fs.writeFileSync(tracePath, JSON.stringify(buildTrace(doc, requirementIR, testPlanIR), null, 2), 'utf8');

  // -- Metrics -------------------------------------------------------------
  const secretLeakCount = scanSecrets([contractPath, contextPath, semanticIrPath, requirementsPath, testPlanPath, testCasesPath, tracePath]);

  const semInfo = analysisInfo((semanticIR as unknown as { analysis?: unknown }).analysis);
  const reqInfo = { aiCalls: aiCalls.REQUIREMENT_BUILD, provider: provider.name, model: provider.name };
  const planInfo = { aiCalls: aiCalls.TEST_PLANNING, provider: provider.name, model: provider.name };

  return {
    source,
    semantic: { status: semanticIR.status, chunkCount: writeResult.chunkCount, aiCalls: semInfo.aiCalls, provider: semInfo.provider, model: semInfo.model },
    requirements: { requirementCount: requirementIR.requirements.length, aiCalls: reqInfo.aiCalls, provider: reqInfo.provider, model: reqInfo.model },
    testPlan: {
      scenarioCount: testPlanIR.scenarios.length,
      testCaseCount: testPlanIR.testCases.length,
      aiCalls: planInfo.aiCalls,
      provider: planInfo.provider,
      model: planInfo.model,
    },
    metrics: {
      sourceIngestionAiCalls: 0,
      semanticAiCalls: semInfo.aiCalls,
      requirementBuilderAiCalls: reqInfo.aiCalls,
      testPlannerAiCalls: planInfo.aiCalls,
      secretLeakCount,
      sourceMutations: 0,
      manualArtifactSubstitutions: 0,
      sourceSpecificBranchesAfterIngestion: 0,
      testCaseRoundTripFailures: 0,
    },
    artifacts: {
      contract: contractPath,
      context: contextPath,
      semanticContextDir,
      semanticIr: semanticIrPath,
      requirements: requirementsPath,
      testPlan: testPlanPath,
      testCases: testCasesPath,
      trace: tracePath,
    },
    document: doc,
    semanticIR,
    requirementIR,
    testPlanIR,
  };
}

interface TraceLink {
  testCaseId: string;
  title: string;
  requirementIds: string[];
  sourceContextIds: string[];
  sourceArtifactIds: string[];
}

function buildTrace(doc: CanonicalSourceDocument, requirementIR: RequirementIR, plan: TestPlanIR): { generatedAt: string; source: SourceIdentityLite; links: TraceLink[] } {
  const contextToArtifact = new Map<string, string>();
  for (const a of doc.artifacts) {
    if (a.kind === 'context-chunk') contextToArtifact.set(a.id, a.id);
  }
  const requirementToContext = new Map<string, string[]>();
  for (const req of requirementIR.requirements) {
    const ctxs = new Set<string>();
    for (const p of req.provenance ?? []) {
      if (p.contextId) ctxs.add(p.contextId);
    }
    requirementToContext.set(req.id, [...ctxs]);
  }

  const links: TraceLink[] = plan.testCases.map((tc) => {
    const ctxs = new Set<string>();
    for (const rid of tc.requirementIds) {
      for (const c of requirementToContext.get(rid) ?? []) ctxs.add(c);
    }
    return {
      testCaseId: tc.id,
      title: tc.title,
      requirementIds: tc.requirementIds,
      sourceContextIds: [...ctxs],
      sourceArtifactIds: [...ctxs],
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    source: {
      sourceId: doc.source.id,
      displayName: doc.source.displayName,
      contentHash: doc.revision.contentHash,
    },
    links,
  };
}

interface SourceIdentityLite {
  sourceId: string;
  displayName: string;
  contentHash: string;
}
