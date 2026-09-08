// ---------------------------------------------------------------------------
// Semantic Analyzer – main orchestrator
// ---------------------------------------------------------------------------
// Two-pass architecture:
//   Pass 1: Chunk-level semantic extraction (per-chunk AI calls)
//   Pass 2: Global consolidation (cross-chunk merge + relationships)
//   Then: Deterministic ID assignment, provenance validation, output.

import type { AIProvider } from 'ai-provider';
import type {
  SemanticIR,
  SemanticEntity,
  SemanticSection,
  SemanticFlow,
  SemanticRule,
  SemanticRelationship,
  SemanticUnresolved,
  SemanticWarning,
  SemanticQualityMetrics,
  SemanticCompletionStatus,
  ChunkSemanticResult,
  AnalysisManifest,
  SemanticAnalyzerOptions,
  SemanticExecutionMetrics,
} from './models.js';
import { SemanticWarningCode, CONFIDENCE_THRESHOLD } from './warnings.js';
import { loadContextPackage } from './persistence/loader.js';
import { analyzeChunk } from './analysis/chunk-analyzer.js';
import { consolidateHierarchically } from './analysis/consolidator.js';
import { buildValidContextIds, buildContextSheetMap, validateProvenanceArray } from './validation/provenance-validator.js';
import { validateRelationships } from './validation/relationship-validator.js';
import { orderEntities, orderSections, orderFlows, orderRules, orderRelationships, orderUnresolved } from './merge/deterministic-order.js';
import { findDuplicateCandidates, applyEntityMerge } from './merge/entity-merger.js';
import { createIdGenerator, buildLocalToGlobalMap, resolveLocalId } from './merge/id-remapper.js';
import { computeConsolidationFingerprint, computeFingerprint } from './fingerprint.js';
import { writeOutput, writeIntermediateResult, readIntermediateResult, readConsolidationCheckpoint, writeConsolidationCheckpoint } from './persistence/writer.js';
import { PROMPT_VERSION } from './prompts/system.js';
import { resolveSemanticBudget, SEMANTIC_REQUEST_LIMIT_EXCEEDED } from './budget.js';

/**
 * Run the full semantic analysis pipeline.
 *
 * @param contextPath Path to the context package directory
 * @param provider AI provider to use (must implement AIProvider interface)
 * @param options Optional configuration
 * @returns The canonical Semantic IR
 */
export async function analyzeSemanticContext(
  contextPath: string,
  provider: AIProvider,
  options?: SemanticAnalyzerOptions,
): Promise<SemanticIR> {
  const promptVersion = options?.promptVersion ?? PROMPT_VERSION;
  const budget = resolveSemanticBudget(options?.budget);
  const requestedConcurrency = options?.concurrency ?? budget.maxConcurrentRequests;
  if (requestedConcurrency < 1) throw new Error('Semantic analyzer concurrency must be positive.');
  const concurrency = Math.min(requestedConcurrency, budget.maxConcurrentRequests);
  const outputDir = options?.outputDir;
  const resume = options?.resume ?? false;
  const model = options?.model ?? provider.name;

  // ---- Load context package -----------------------------------------------
  const loaded = loadContextPackage(contextPath);
  const { manifest, chunks } = loaded;

  let chunksToAnalyze = chunks;
  if (options?.sheets && options.sheets.length > 0) {
    const sheetSet = new Set(options.sheets);
    chunksToAnalyze = chunks.filter((c) => sheetSet.has(c.sheet.name));
  }

  // ---- Pass 1: Chunk-level analysis ---------------------------------------
  const chunkResults: ChunkSemanticResult[] = [];
  const allWarnings: SemanticWarning[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let aiRequests = 0;
  let requestStarts = 0;
  let contextsReused = 0;
  let contextsFailed = 0;
  let checkpointHits = 0;
  let checkpointMisses = 0;
  let peakConcurrency = 0;
  let activeConcurrency = 0;
  let schemaRepairs = 0;
  let estimatedInputTokens = 0;
  let maxEstimatedTokensPerRequest = 0;
  let totalOutputBudgetEscalations = 0;
  let minInitialOutputBudget = Infinity;
  let maxFinalOutputBudget = 0;

  const validContextIds = buildValidContextIds(chunks);
  const contextSheetMap = buildContextSheetMap(chunks);

  // Process chunks with concurrency limit
  const results = await processWithConcurrency(
    chunksToAnalyze,
    concurrency,
    async (chunk) => {
      // Check resume cache
      if (resume && outputDir) {
        const fp = computeFingerprint(chunk.content, promptVersion, model, undefined, undefined, options?.providerOptions, budget.outputBudgetPolicy);
        const cached = readIntermediateResult(outputDir, chunk.id, fp, provider.name, model, promptVersion);
        if (cached) {
          checkpointHits++;
          contextsReused++;
          return { result: cached.result, usage: cached.usage as { inputTokens?: number; outputTokens?: number; totalTokens?: number }, reused: true, fingerprint: fp, repairs: 0, warnings: undefined, metrics: { requests: 0, schemaRepairs: 0, estimatedInputTokens: 0, maxEstimatedInputTokens: 0, initialOutputBudget: budget.maxOutputTokensPerRequest, finalOutputBudget: budget.maxOutputTokensPerRequest, outputBudgetEscalations: 0, finishReason: 'cached' } };
        }
        checkpointMisses++;
      }

      requestStarts++;
      if (budget.maxTotalRequests && requestStarts > budget.maxTotalRequests) {
        throw new Error(`${SEMANTIC_REQUEST_LIMIT_EXCEEDED}: ${budget.maxTotalRequests}`);
      }
      activeConcurrency++;
      peakConcurrency = Math.max(peakConcurrency, activeConcurrency);
      try {
        const analysis = await analyzeChunk(chunk, provider, budget, options?.providerOptions);
        const fingerprint = computeFingerprint(chunk.content, promptVersion, model, undefined, undefined, options?.providerOptions, budget.outputBudgetPolicy);
        if (outputDir) {
          writeIntermediateResult(outputDir, chunk.id, analysis.result, provider.name, model, analysis.usage as Record<string, unknown>, fingerprint, promptVersion);
        }
        return { ...analysis, reused: false, fingerprint, repairs: analysis.warnings?.length ?? 0 };
      } catch (error) {
        contextsFailed++;
        if (process.env.TIRAI_SEMANTIC_SKIP_FAILED_CHUNKS === '1') {
          const skipped: ChunkSemanticResult = {
            contextId: chunk.id,
            sections: [],
            entities: [],
            flows: [],
            rules: [],
            relationships: [],
            unresolved: [{
              localId: 'skip-output-limit',
              type: 'analysis-skipped',
              description: 'Chunk skipped after semantic analysis failure',
              provenance: [],
              reason: error instanceof Error ? error.message : String(error),
            }],
          };
          return {
            result: skipped,
            usage: {},
            reused: false,
            fingerprint: computeFingerprint(chunk.content, promptVersion, model, undefined, undefined, options?.providerOptions, budget.outputBudgetPolicy),
            repairs: 0,
            warnings: [{
              code: 'CHUNK_ANALYSIS_SKIPPED',
              message: error instanceof Error ? error.message : String(error),
              contextId: chunk.id,
            }],
            metrics: {
              requests: 0,
              schemaRepairs: 0,
              estimatedInputTokens: 0,
              maxEstimatedInputTokens: 0,
              initialOutputBudget: budget.maxOutputTokensPerRequest,
              finalOutputBudget: budget.maxOutputTokensPerRequest,
              outputBudgetEscalations: 0,
              finishReason: 'skipped',
            },
          };
        }
        throw error;
      } finally {
        activeConcurrency--;
      }
    },
  );

  for (let i = 0; i < chunksToAnalyze.length; i++) {
    const { result, usage, warnings: repairWarnings } = results[i]!;

    chunkResults.push(result);
    if (!results[i]!.reused) aiRequests++;
    totalInputTokens += usage.inputTokens ?? 0;
    totalOutputTokens += usage.outputTokens ?? 0;
    schemaRepairs += results[i]!.repairs;
    if (!results[i]!.reused) {
      estimatedInputTokens += results[i]!.metrics.estimatedInputTokens;
      maxEstimatedTokensPerRequest = Math.max(maxEstimatedTokensPerRequest, results[i]!.metrics.maxEstimatedInputTokens);
      totalOutputBudgetEscalations += results[i]!.metrics.outputBudgetEscalations;
      minInitialOutputBudget = Math.min(minInitialOutputBudget, results[i]!.metrics.initialOutputBudget);
      maxFinalOutputBudget = Math.max(maxFinalOutputBudget, results[i]!.metrics.finalOutputBudget);
    }

    // Collect repair warnings from schema repair attempts
    if (repairWarnings) {
      allWarnings.push(...repairWarnings);
    }

    // Validate provenance for all extracted objects
    validateChunkProvenance(result, validContextIds, contextSheetMap, allWarnings);

    // Check confidence levels
    checkConfidence(result, allWarnings);

  }

  // ---- Pass 2: Global consolidation ---------------------------------------
  const sheetNames = manifest.sheets.map((s) => s.name);
  let consolidationResult;
  let consolidationComplete = true;
  let consolidationRequests = 0;
  const consolidationFingerprint = computeConsolidationFingerprint(
    chunkResults.map((result, i) => ({ result, sourceFingerprint: results[i]!.fingerprint })),
    promptVersion,
    model,
    { maxContextsPerBatch: budget.maxContextsPerBatch, maxConsolidationItemsPerBatch: budget.maxConsolidationItemsPerBatch, maxConsolidationInputTokens: budget.maxConsolidationInputTokens },
    options?.providerOptions,
  );

  try {
    const cachedConsolidation = resume && outputDir
      ? readConsolidationCheckpoint(outputDir, consolidationFingerprint, provider.name, model, promptVersion)
      : null;
    if (cachedConsolidation) {
      consolidationResult = cachedConsolidation;
    } else {
    const cons = await consolidateHierarchically(chunkResults, sheetNames, provider, budget, contextSheetMap, aiRequests, outputDir ? {
      outputDir,
      resume,
      provider: provider.name,
      model,
      promptVersion,
      providerOptions: options?.providerOptions,
      } : undefined, options?.providerOptions);
      consolidationResult = cons.result;
      consolidationRequests = cons.metrics.batchRequests + cons.metrics.globalRequests;
      aiRequests += consolidationRequests;
      totalInputTokens += cons.usage.inputTokens ?? 0;
      totalOutputTokens += cons.usage.outputTokens ?? 0;
      estimatedInputTokens += cons.metrics.estimatedInputTokens;
      maxEstimatedTokensPerRequest = Math.max(maxEstimatedTokensPerRequest, cons.metrics.maxEstimatedInputTokens);
      if (outputDir) writeConsolidationCheckpoint(outputDir, consolidationFingerprint, consolidationResult, provider.name, model, promptVersion);
    }
  } catch (err) {
    consolidationComplete = false;
    allWarnings.push({
      code: SemanticWarningCode.CONSOLIDATION_PARTIAL,
      message: `Global consolidation failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    consolidationResult = { mergeCandidates: [], crossChunkRelationships: [] };
  }

  // ---- Merge phase --------------------------------------------------------

  // Deterministic ordering
  const orderedEntities = orderEntities(chunkResults);
  const orderedSections = orderSections(chunkResults);
  const orderedFlows = orderFlows(chunkResults);
  const orderedRules = orderRules(chunkResults);
  const orderedRelationships = orderRelationships(chunkResults);
  const orderedUnresolved = orderUnresolved(chunkResults);

  // Entity deduplication (deterministic signals)
  const dedupMergeGroups = findDuplicateCandidates(orderedEntities);
  const { merged: dedupedEntities, warnings: mergeWarnings } = applyEntityMerge(orderedEntities, dedupMergeGroups);
  allWarnings.push(...mergeWarnings);

  // Assign global IDs
  const secIdGen = createIdGenerator('sec');
  const entIdGen = createIdGenerator('ent');
  const flowIdGen = createIdGenerator('flow');
  const ruleIdGen = createIdGenerator('rule');
  const relIdGen = createIdGenerator('rel');
  const unresIdGen = createIdGenerator('unresolved');

  const sectionGlobalIds = orderedSections.map(() => secIdGen());
  const entityGlobalIds = dedupedEntities.map(() => entIdGen());
  const flowGlobalIds = orderedFlows.map(() => flowIdGen());
  const ruleGlobalIds = orderedRules.map(() => ruleIdGen());

  // Build final semantic objects
  const finalSections: SemanticSection[] = orderedSections.map((s, i) => ({
    id: sectionGlobalIds[i]!,
    title: s.section.title,
    description: s.section.description,
    type: s.section.type,
    provenance: s.section.provenance,
    confidence: s.section.confidence,
  }));

  const finalEntities: SemanticEntity[] = dedupedEntities.map((e, i) => ({
    id: entityGlobalIds[i]!,
    name: e.entity.name,
    type: e.entity.type,
    description: e.entity.description,
    attributes: e.entity.attributes,
    aliases: e.entity.aliases,
    provenance: e.entity.provenance,
    confidence: e.entity.confidence,
  }));

  const finalFlows: SemanticFlow[] = orderedFlows.map((f, i) => ({
    id: flowGlobalIds[i]!,
    name: f.flow.name,
    description: f.flow.description,
    actors: f.flow.actors,
    steps: f.flow.steps,
    preconditions: f.flow.preconditions,
    postconditions: f.flow.postconditions,
    provenance: f.flow.provenance,
    confidence: f.flow.confidence,
  }));

  const finalRules: SemanticRule[] = orderedRules.map((r, i) => ({
    id: ruleGlobalIds[i]!,
    type: r.rule.type,
    statement: r.rule.statement,
    conditions: r.rule.conditions,
    effects: r.rule.effects,
    provenance: r.rule.provenance,
    confidence: r.rule.confidence,
  }));

  // Build ID map for relationship remapping
  const idMap = buildLocalToGlobalMap(
    chunkResults,
    entityGlobalIds,
    sectionGlobalIds,
    flowGlobalIds,
    ruleGlobalIds,
    [], // relationship IDs assigned below
    orderedUnresolved.map(() => unresIdGen()),
  );

  // Remap intra-chunk relationships
  const finalRelationships: SemanticRelationship[] = [];
  for (const { contextId, rel } of orderedRelationships) {
    const sourceId = resolveLocalId(idMap, contextId, rel.sourceLocalId);
    const targetId = resolveLocalId(idMap, contextId, rel.targetLocalId);
    finalRelationships.push({
      id: relIdGen(),
      type: rel.type,
      sourceId,
      targetId,
      description: rel.description,
      provenance: rel.provenance,
      confidence: rel.confidence,
    });
  }

  // Add cross-chunk relationships from consolidation
  if (consolidationResult.crossChunkRelationships) {
    for (const rel of consolidationResult.crossChunkRelationships) {
      // Cross-chunk refs use "contextId:localId" format
      const sourceId = resolveCrossChunkRef(idMap, rel.sourceLocalId);
      const targetId = resolveCrossChunkRef(idMap, rel.targetLocalId);
      finalRelationships.push({
        id: relIdGen(),
        type: rel.type,
        sourceId,
        targetId,
        description: rel.description,
        provenance: rel.provenance,
        confidence: rel.confidence,
      });
    }
  }

  // Build final unresolved items
  const finalUnresolved: SemanticUnresolved[] = orderedUnresolved.map((u, i) => ({
    id: `unresolved-${String(i).padStart(4, '0')}`,
    type: u.item.type,
    description: u.item.description,
    candidates: u.item.candidates,
    provenance: u.item.provenance,
    reason: u.item.reason,
  }));

  // ---- Validate relationships ---------------------------------------------
  const entityIds = new Set(finalEntities.map((e) => e.id));
  const sectionIds = new Set(finalSections.map((s) => s.id));
  const flowIds = new Set(finalFlows.map((f) => f.id));
  const relWarnings = validateRelationships(finalRelationships, entityIds, sectionIds, flowIds);
  allWarnings.push(...relWarnings);

  // ---- Build document model -----------------------------------------------
  const document = {
    title: consolidationResult.documentSummary?.title,
    summary: consolidationResult.documentSummary?.summary,
    language: consolidationResult.documentSummary?.language,
    domainHints: consolidationResult.documentSummary?.domainHints,
    provenance: chunks.map((c) => ({
      contextId: c.id,
      sheet: c.sheet.name,
      ranges: c.provenance.ranges,
    })),
  };

  // ---- Build analysis metadata --------------------------------------------
  const totalTokens = totalInputTokens + totalOutputTokens;

  // Compute quality metrics (v1.1)
  const totalFlowSteps = finalFlows.reduce((sum, f) => sum + f.steps.length, 0);
  const allSemanticObjects = [
    ...finalEntities,
    ...finalFlows,
    ...finalRules,
    ...finalRelationships,
    ...finalSections,
  ];
  const lowConfCount = allSemanticObjects.filter((o) => o.confidence < CONFIDENCE_THRESHOLD.MEDIUM).length;
  const withProvenance = allSemanticObjects.filter((o) => o.provenance.length > 0).length;
  const provCoverage = allSemanticObjects.length > 0
    ? Math.round((withProvenance / allSemanticObjects.length) * 100) / 100
    : 1;

  const quality: SemanticQualityMetrics = {
    entities: finalEntities.length,
    flows: finalFlows.length,
    flowSteps: totalFlowSteps,
    rules: finalRules.length,
    relationships: finalRelationships.length,
    unresolved: finalUnresolved.length,
    lowConfidenceCount: lowConfCount,
    provenanceCoverage: provCoverage,
  };

  const analysis = {
    provider: provider.name,
    model,
    promptVersion,
    chunksAnalyzed: chunkResults.length,
    aiRequests,
    usage: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalTokens,
    },
    warnings: allWarnings,
    quality,
    metrics: {
      contextsTotal: chunksToAnalyze.length,
      contextsProcessed: chunksToAnalyze.length - contextsReused - contextsFailed,
      contextsReused,
      contextsFailed,
      chunkRequests: aiRequests - consolidationRequests,
      consolidationRequests,
      transportRetries: 0,
      schemaRepairs,
      estimatedInputTokens,
      maxEstimatedTokensPerRequest,
      peakConcurrency,
      checkpointHits,
      checkpointMisses,
      initialOutputBudget: minInitialOutputBudget === Infinity ? budget.maxOutputTokensPerRequest : minInitialOutputBudget,
      finalOutputBudget: maxFinalOutputBudget,
      outputBudgetEscalations: totalOutputBudgetEscalations,
      outputBudgetCeiling: budget.outputBudgetPolicy?.maxOutputBudgetCeiling ?? budget.maxOutputTokensPerRequest,
    } satisfies SemanticExecutionMetrics,
  };

  // ---- Determine completion status ----------------------------------------
  const contextsExpected = chunksToAnalyze.length;
  const contextsCompleted = chunkResults.length;
  const allChunksSucceeded = contextsCompleted === contextsExpected && contextsFailed === 0;

  // Canonical IR is only published as 'complete' when ALL mandatory stages succeeded.
  // Partial output is written with explicit status for diagnostic/resume purposes.
  let status: SemanticCompletionStatus = 'failed';
  if (allChunksSucceeded && consolidationComplete) {
    status = 'complete';
  } else if (allChunksSucceeded || contextsCompleted > 0) {
    status = 'partial';
  }

  // ---- Assemble final IR --------------------------------------------------
  const semanticIR: SemanticIR = {
    schemaVersion: '1.0',
    status,
    document,
    sections: finalSections,
    entities: finalEntities,
    flows: finalFlows,
    rules: finalRules,
    relationships: finalRelationships,
    unresolved: finalUnresolved,
    analysis: {
      ...analysis,
      consolidationComplete,
      contextsExpected,
      contextsCompleted,
    },
  };

  // ---- Write output -------------------------------------------------------
  if (outputDir) {
    const analysisManifest: AnalysisManifest = {
      schemaVersion: '1.0',
      status,
      source: { contextManifest: loaded.contextDir },
      provider: { name: provider.name, model: analysis.model },
      promptVersion,
      stats: {
        chunks: chunkResults.length,
        aiRequests,
        entities: finalEntities.length,
        sections: finalSections.length,
        flows: finalFlows.length,
        flowSteps: totalFlowSteps,
        rules: finalRules.length,
        relationships: finalRelationships.length,
        unresolved: finalUnresolved.length,
      },
      usage: analysis.usage,
      warnings: allWarnings,
      metrics: analysis.metrics,
      consolidationComplete,
      contextsExpected,
      contextsCompleted,
    };

    writeOutput(outputDir, semanticIR, analysisManifest, chunkResults.map((r, i) => ({
      contextId: chunksToAnalyze[i]!.id,
      result: r,
      provider: provider.name,
      model: analysis.model,
      usage: {},
      fingerprint: results[i]!.fingerprint,
      promptVersion,
    })));
  }

  return semanticIR;
}

// ---- Helpers --------------------------------------------------------------

function validateChunkProvenance(
  result: ChunkSemanticResult,
  validContextIds: Set<string>,
  contextSheetMap: Map<string, string>,
  warnings: SemanticWarning[],
): void {
  for (const e of result.entities) {
    warnings.push(...validateProvenanceArray(e.provenance, validContextIds, contextSheetMap, e.localId));
  }
  for (const f of result.flows) {
    warnings.push(...validateProvenanceArray(f.provenance, validContextIds, contextSheetMap, f.localId));
    // Also validate individual flow step provenance
    for (const step of f.steps) {
      if (step.provenance && step.provenance.length > 0) {
        warnings.push(...validateProvenanceArray(step.provenance, validContextIds, contextSheetMap, `${f.localId}:step-${step.order}`));
      }
    }
  }
  for (const r of result.rules) {
    warnings.push(...validateProvenanceArray(r.provenance, validContextIds, contextSheetMap, r.localId));
  }
  for (const s of result.sections) {
    warnings.push(...validateProvenanceArray(s.provenance, validContextIds, contextSheetMap, s.localId));
  }
  for (const rel of result.relationships) {
    warnings.push(...validateProvenanceArray(rel.provenance, validContextIds, contextSheetMap, rel.localId));
  }
}

function checkConfidence(result: ChunkSemanticResult, warnings: SemanticWarning[]): void {
  for (const e of result.entities) {
    if (e.confidence < CONFIDENCE_THRESHOLD.MEDIUM) {
      warnings.push({
        code: SemanticWarningCode.LOW_CONFIDENCE,
        message: `Entity "${e.name}" has low confidence: ${e.confidence}`,
        contextId: result.contextId,
        objectId: e.localId,
      });
    }
  }
  for (const f of result.flows) {
    if (f.confidence < CONFIDENCE_THRESHOLD.MEDIUM) {
      warnings.push({
        code: SemanticWarningCode.LOW_CONFIDENCE,
        message: `Flow "${f.name}" has low confidence: ${f.confidence}`,
        contextId: result.contextId,
        objectId: f.localId,
      });
    }
  }
  for (const r of result.rules) {
    if (r.confidence < CONFIDENCE_THRESHOLD.MEDIUM) {
      warnings.push({
        code: SemanticWarningCode.LOW_CONFIDENCE,
        message: `Rule "${r.localId}" has low confidence: ${r.confidence}`,
        contextId: result.contextId,
        objectId: r.localId,
      });
    }
  }
}

function resolveCrossChunkRef(idMap: Map<string, string>, ref: string): string {
  // Cross-chunk refs are in "contextId:localId" format
  if (idMap.has(ref)) return idMap.get(ref)!;
  // Try splitting
  const parts = ref.split(':');
  if (parts.length >= 2) {
    const contextId = parts[0];
    const localId = parts.slice(1).join(':');
    const resolved = idMap.get(`${contextId}:${localId}`);
    if (resolved) return resolved;
  }
  return ref; // Return as-is if not found (will be caught by relationship validator)
}

/**
 * Process items with a concurrency limit.
 * Results are returned in the same order as the input.
 */
async function processWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await fn(items[idx]!, idx);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);

  return results;
}
