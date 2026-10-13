// ---------------------------------------------------------------------------
// Source-to-TestCase pipeline orchestration (deterministic only)
// ---------------------------------------------------------------------------
// TIRAI embeds no AI. The pipeline opens the source through the
// SourceConnectorRegistry (no source-specific branching after ingestion),
// persists the raw/semantic context packages plus `ai-input.json` for the
// host agent, and then either:
//   a) compiles a structured detailed-design workbook into canonical IR
//      deterministically (structured-design-compiler), or
//   b) stops after ingestion: downstream stages are marked `awaiting-agent`
//      and the host agent supplies semantic-ir/requirements/test-plan/
//      testcases/contract via `tirai artifact import`.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import {
  createDefaultSourceConnectorRegistry,
  type CanonicalSourceDocument,
  type LocalSourceInput,
} from 'source-ingestion';
import type { SemanticIR } from 'semantic-analyzer';
import type { RequirementIR } from 'requirement-builder';
import type { TestPlanIR } from 'test-planner';
import { writeSemanticContextPackage } from './bridge.js';
import { scanSecrets } from './secret-scan.js';
import { compileStructuredDesignDocument } from './structured-design-compiler.js';
import { buildContractIR } from './contract-builder.js';
import { writeRawContextPackage } from './raw-context.js';
import { planArtifacts } from './artifact-planner.js';

export type PipelineStage = 'SOURCE_INGESTION' | 'SEMANTIC_ANALYSIS' | 'REQUIREMENT_BUILD' | 'TEST_PLANNING';

export class SourceToTestCaseError extends Error {
  constructor(public readonly stage: PipelineStage, message: string, public readonly cause?: unknown) {
    super(`[${stage}] ${message}`);
    this.name = 'SourceToTestCaseError';
  }
}

function writeStageCheckpoint(outputDir: string, stage: PipelineStage, status: 'completed' | 'awaiting-agent' | 'failed', details: Record<string, unknown> = {}): void {
  const checkpointDir = path.join(outputDir, 'checkpoints');
  fs.mkdirSync(checkpointDir, { recursive: true });
  fs.writeFileSync(path.join(checkpointDir, `${stage.toLowerCase()}.json`), JSON.stringify({ schemaVersion: '1.0', stage, status, ...details }, null, 2), 'utf8');
}

export interface SourceToTestCaseOptions {
  sourcePath: string;
  outputDir: string;
  sourceKind?: string;
  sourceCodePath?: string;
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

export type PipelineProvider = 'deterministic' | 'structured-design-compiler' | 'agent-imported';

export interface SourceToTestCaseResult {
  source: SourceIdentity;
  semantic: { status: string; chunkCount: number; aiCalls: number; provider: PipelineProvider; model: 'none' };
  requirements: { requirementCount: number; aiCalls: number; provider: PipelineProvider; model: 'none' };
  testPlan: { scenarioCount: number; testCaseCount: number; aiCalls: number; provider: PipelineProvider; model: 'none' };
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
    rawContextDir: string;
    rawContextManifest: string;
    semanticIr: string;
    requirements: string;
    testPlan: string;
    testCases: string;
    trace: string;
    aiRun: string;
    artifactPlan: string;
    testDesignSummary: string;
    aiInput: string;
  };
  document: CanonicalSourceDocument;
  /** Present only when the structured-design compiler produced IR; otherwise the host agent imports it via `tirai artifact import`. */
  semanticIR?: SemanticIR;
  requirementIR?: RequirementIR;
  testPlanIR?: TestPlanIR;
}

export async function runSourceToTestCasePipeline(opts: SourceToTestCaseOptions): Promise<SourceToTestCaseResult> {
  const { sourcePath, outputDir } = opts;
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
    writeStageCheckpoint(outputDir, 'SOURCE_INGESTION', 'completed', { artifactCount: doc.artifacts.length, contextCount: doc.contexts.length });
  } catch (err) {
    writeStageCheckpoint(outputDir, 'SOURCE_INGESTION', 'failed', { error: err instanceof Error ? err.message : String(err) });
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
  const rawContext = writeRawContextPackage(doc, path.join(outputDir, 'raw-context'));
  const aiInputPath = path.join(outputDir, 'ai-input.json');
  fs.writeFileSync(aiInputPath, JSON.stringify({ schemaVersion: '1.0', purpose: 'unified-agent-test-design-input', source: doc.source, revision: doc.revision, artifacts: doc.artifacts, contexts: doc.contexts, sourcePath, sourceCode: collectSourceCode(opts.sourceCodePath), policy: { requireDimensions: ['happy-path', 'negative', 'boundary', 'validation', 'empty', 'loading', 'error', 'state-transition', 'security'], requireAssertions: true, requireProvenance: true } }, null, 2), 'utf8');

  // Structured detailed-design workbooks already carry explicit row-level
  // requirements. Compile that contract deterministically whenever the
  // workbook exposes a business-flow table; every other source stops after
  // ingestion and waits for the host agent to import its IR artifacts.
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
    const aiRunPath = path.join(outputDir, 'ai-run.json');
    const artifactPlanPath = path.join(outputDir, 'artifact-plan.json');
    const testDesignSummaryPath = path.join(outputDir, 'test-design-summary.json');

    fs.writeFileSync(contextPath, JSON.stringify(doc, null, 2), 'utf8');
    const contract = buildContractIR({ document: doc, semanticIR, requirementIR, testPlanIR });
    fs.writeFileSync(artifactPlanPath, JSON.stringify(planArtifacts(contract), null, 2), 'utf8');
    fs.writeFileSync(testDesignSummaryPath, JSON.stringify(buildTestDesignSummary(testPlanIR), null, 2), 'utf8');
    fs.writeFileSync(contractPath, JSON.stringify(contract, null, 2), 'utf8');
    fs.writeFileSync(semanticIrPath, JSON.stringify(semanticIR, null, 2), 'utf8');
    fs.writeFileSync(requirementsPath, JSON.stringify(requirementIR, null, 2), 'utf8');
    fs.writeFileSync(testPlanPath, JSON.stringify(testPlanIR, null, 2), 'utf8');
    fs.writeFileSync(testCasesPath, JSON.stringify(testPlanIR.testCases, null, 2), 'utf8');
    fs.writeFileSync(tracePath, JSON.stringify(buildTrace(doc, requirementIR, testPlanIR), null, 2), 'utf8');
    fs.writeFileSync(aiRunPath, JSON.stringify({ schemaVersion: '1.0', stages: [
      { name: 'source-ingestion', mode: 'connector', aiCalls: 0 },
      { name: 'semantic-analysis', mode: 'deterministic', aiCalls: 0, reason: 'structured design rows are already normalized requirements' },
      { name: 'requirement-build', mode: 'deterministic', aiCalls: 0, reason: 'requirements are compiled from explicit design rows' },
      { name: 'test-planning', mode: 'deterministic', aiCalls: 0, reason: 'test scenarios are compiled with source traceability' },
    ] }, null, 2), 'utf8');

    writeStageCheckpoint(outputDir, 'SEMANTIC_ANALYSIS', 'completed', { artifact: 'semantic-ir.json', aiCalls: 0, provider: 'structured-design-compiler' });
    writeStageCheckpoint(outputDir, 'REQUIREMENT_BUILD', 'completed', { artifact: 'requirements.json', aiCalls: 0, provider: 'structured-design-compiler' });
    writeStageCheckpoint(outputDir, 'TEST_PLANNING', 'completed', { artifact: 'test-plan.json', aiCalls: 0, provider: 'structured-design-compiler' });

    const secretLeakCount = scanSecrets([contractPath, contextPath, semanticIrPath, requirementsPath, testPlanPath, testCasesPath, tracePath, aiRunPath, artifactPlanPath, aiInputPath, ...rawContext.files]);
    const semanticProvider = 'structured-design-compiler' as const;
    const semanticModel = 'none' as const;
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
        rawContextDir: rawContext.dir,
        rawContextManifest: rawContext.manifestPath,
        semanticIr: semanticIrPath,
        requirements: requirementsPath,
        testPlan: testPlanPath,
        testCases: testCasesPath,
        trace: tracePath,
        aiRun: aiRunPath,
        artifactPlan: artifactPlanPath,
        testDesignSummary: testDesignSummaryPath,
        aiInput: aiInputPath,
      },
      document: doc,
      semanticIR,
      requirementIR,
      testPlanIR,
    };
  }

  // -- Awaiting host agent -------------------------------------------------
  // TIRAI makes no embedded AI calls. The raw context, semantic context and
  // `ai-input.json` packages written above are the host agent's inputs; the
  // agent later supplies semantic-ir.json / requirements.json /
  // test-plan.json / testcases.json / contract.json via `tirai artifact
  // import`. Downstream stages are recorded as awaiting-agent so consumers
  // fail closed instead of guessing.
  const contextPath = path.join(outputDir, 'context.json');
  const contractPath = path.join(outputDir, 'contract.json');
  const semanticIrPath = path.join(outputDir, 'semantic-ir.json');
  const requirementsPath = path.join(outputDir, 'requirements.json');
  const testPlanPath = path.join(outputDir, 'test-plan.json');
  const testCasesPath = path.join(outputDir, 'testcases.json');
  const tracePath = path.join(outputDir, 'trace.json');
  const aiRunPath = path.join(outputDir, 'ai-run.json');
  const artifactPlanPath = path.join(outputDir, 'artifact-plan.json');
  const testDesignSummaryPath = path.join(outputDir, 'test-design-summary.json');

  fs.writeFileSync(contextPath, JSON.stringify(doc, null, 2), 'utf8');
  fs.writeFileSync(aiRunPath, JSON.stringify({ schemaVersion: '1.0', stages: [
    { name: 'source-ingestion', mode: 'connector', aiCalls: 0 },
    { name: 'semantic-analysis', mode: 'awaiting-agent', aiCalls: 0, reason: 'host agent supplies semantic-ir via tirai artifact import' },
    { name: 'requirement-build', mode: 'awaiting-agent', aiCalls: 0, reason: 'host agent supplies requirements via tirai artifact import' },
    { name: 'test-planning', mode: 'awaiting-agent', aiCalls: 0, reason: 'host agent supplies test-plan/testcases via tirai artifact import' },
  ] }, null, 2), 'utf8');

  writeStageCheckpoint(outputDir, 'SEMANTIC_ANALYSIS', 'awaiting-agent', { artifact: 'semantic-ir.json', aiCalls: 0 });
  writeStageCheckpoint(outputDir, 'REQUIREMENT_BUILD', 'awaiting-agent', { artifact: 'requirements.json', aiCalls: 0 });
  writeStageCheckpoint(outputDir, 'TEST_PLANNING', 'awaiting-agent', { artifact: 'test-plan.json', aiCalls: 0 });

  const secretLeakCount = scanSecrets([contextPath, aiRunPath, aiInputPath, ...rawContext.files]);
  const semanticProvider = 'agent-imported' as const;
  const semanticModel = 'none' as const;
  return {
    source,
    semantic: { status: 'awaiting-agent', chunkCount: writeResult.chunkCount, aiCalls: 0, provider: semanticProvider, model: semanticModel },
    requirements: { requirementCount: 0, aiCalls: 0, provider: semanticProvider, model: semanticModel },
    testPlan: {
      scenarioCount: 0,
      testCaseCount: 0,
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
      rawContextDir: rawContext.dir,
      rawContextManifest: rawContext.manifestPath,
      semanticIr: semanticIrPath,
      requirements: requirementsPath,
      testPlan: testPlanPath,
      testCases: testCasesPath,
      trace: tracePath,
      aiRun: aiRunPath,
      artifactPlan: artifactPlanPath,
      testDesignSummary: testDesignSummaryPath,
      aiInput: aiInputPath,
    },
    document: doc,
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

function buildTestDesignSummary(plan: TestPlanIR): { schemaVersion: '1.0'; testCases: number; byCategory: Record<string, number>; byAutomation: Record<string, number>; requirementsCovered: number; behaviorPaths: number; requiredDimensions: string[]; coveredDimensions: string[]; missingDimensions: string[]; dimensionGaps: Array<{ dimension: string; status: 'unresolved'; reason: string }> } {
  const requiredDimensions = ['happy-path', 'negative', 'boundary', 'validation', 'empty', 'loading', 'error', 'permission', 'state-transition', 'retry', 'rollback'];
  const byCategory: Record<string, number> = {};
  const byAutomation: Record<string, number> = {};
  for (const scenario of plan.scenarios) byCategory[scenario.category] = (byCategory[scenario.category] ?? 0) + 1;
  for (const testCase of plan.testCases) { const status = testCase.automation.status; byAutomation[status] = (byAutomation[status] ?? 0) + 1; }
  const coveredDimensions = requiredDimensions.filter((dimension) => (byCategory[dimension] ?? 0) > 0);
  const missingDimensions = requiredDimensions.filter((dimension) => !coveredDimensions.includes(dimension));
  return { schemaVersion: '1.0', testCases: plan.testCases.length, byCategory, byAutomation, requirementsCovered: plan.quality.requirementsCovered, behaviorPaths: plan.scenarios.length, requiredDimensions, coveredDimensions, missingDimensions, dimensionGaps: missingDimensions.map((dimension) => ({ dimension, status: 'unresolved' as const, reason: `No ${dimension} scenario was established from the supplied requirements and source evidence.` })) };
}

function collectSourceCode(root?: string): { root?: string; files: Array<{ path: string; content: string; contentHash: string; truncated?: boolean }> } {
  if (!root || !fs.existsSync(root)) return { root, files: [] };
  const files: Array<{ path: string; content: string; contentHash: string; truncated?: boolean }> = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', '.tirai', '.vercel', 'dist', 'build', 'coverage', '.next', 'out'].includes(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (/\.(ts|tsx|js|jsx|vue|svelte|py|java|go|rb|cs)$/.test(entry.name)) {
        const content = fs.readFileSync(absolute, 'utf8');
        const maxChars = 200_000;
        files.push({ path: path.relative(root, absolute), content: content.slice(0, maxChars), contentHash: createHash('sha256').update(content).digest('hex'), ...(content.length > maxChars ? { truncated: true } : {}) });
      }
    }
  };
  visit(root); files.sort((a, b) => a.path.localeCompare(b.path)); return { root, files };
}
