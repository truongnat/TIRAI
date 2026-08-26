// ---------------------------------------------------------------------------
// Semantic Analyzer – main orchestrator
// ---------------------------------------------------------------------------
// Two-pass architecture:
//   Pass 1: Chunk-level semantic extraction (per-chunk AI calls)
//   Pass 2: Global consolidation (cross-chunk merge + relationships)
//   Then: Deterministic ID assignment, provenance validation, output.

import type { AIProvider } from 'ai-provider';
import { assertCanonicalSourceDocument, sha256, type CanonicalSourceDocument } from 'source-ingestion';
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
  ChunkSemanticResult,
  AnalysisManifest,
  SemanticAnalyzerOptions,
  SemanticExecutionMetrics,
} from './models.js';
import { SemanticWarningCode, CONFIDENCE_THRESHOLD } from './warnings.js';
import {
  loadContextPackage,
  type AnalyzerContextChunk,
  type CanonicalAnalyzerChunk,
} from './persistence/loader.js';
import { analyzeChunk } from './analysis/chunk-analyzer.js';
import { consolidateHierarchically } from './analysis/consolidator.js';
import {
  buildValidContextIds,
  buildContextSheetMap,
  buildContextProvenanceMap,
  validateProvenanceArray,
} from './validation/provenance-validator.js';
import { validateRelationships } from './validation/relationship-validator.js';
import {
  orderEntities,
  orderSections,
  orderFlows,
  orderRules,
  orderRelationships,
  orderUnresolved,
} from './merge/deterministic-order.js';
import { findDuplicateCandidates, applyEntityMerge } from './merge/entity-merger.js';
import { createIdGenerator, buildLocalToGlobalMap, resolveLocalId } from './merge/id-remapper.js';
import { computeConsolidationFingerprint, computeFingerprint } from './fingerprint.js';
import {
  writeOutput,
  writeIntermediateResult,
  readIntermediateResult,
  readConsolidationCheckpoint,
  writeConsolidationCheckpoint,
} from './persistence/writer.js';
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
  const loaded = loadContextPackage(contextPath);
  return analyzeContextChunks(
    loaded.chunks,
    {
      contextOrigin: loaded.contextDir,
      contextGroups: loaded.manifest.sheets.map((sheet) => sheet.name),
    },
    provider,
    options,
  );
}

/** Analyze canonical source contexts without converting them into Excel-shaped input. */
export async function analyzeCanonicalContext(
  document: CanonicalSourceDocument,
  provider: AIProvider,
  options?: SemanticAnalyzerOptions,
): Promise<SemanticIR> {
  assertCanonicalSourceDocument(document);
  const chunks: CanonicalAnalyzerChunk[] = document.contexts.map((context) => ({
    schemaVersion: '1.0',
    id: context.id,
    type: context.type,
    content: context.content,
    provenance: context.provenance,
    relations: context.relations,
    metadata: context.metadata,
    location: context.provenance.location,
  }));
  return analyzeContextChunks(
    chunks,
    {
      contextOrigin: `canonical:${document.source.id}:${document.revision.id}`,
      contextGroups: [...new Set(chunks.map((chunk) => contextGroup(chunk)))],
      source: {
        sourceId: document.source.id,
        revisionId: document.revision.id,
        kind: document.source.kind,
        displayName: document.source.displayName,
        connectorId: document.source.connectorId,
        connectorVersion: document.source.connectorVersion,
        contentHash: document.revision.contentHash,
      },
    },
    provider,
    options,
  );
}

interface AnalysisSourceInput {
  contextOrigin: string;
  contextGroups: string[];
  source?: SemanticIR['document']['source'];
}

async function analyzeContextChunks(
  chunks: AnalyzerContextChunk[],
  sourceInput: AnalysisSourceInput,
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

  let chunksToAnalyze = chunks;
  if (options?.sheets && options.sheets.length > 0) {
    const sheetSet = new Set(options.sheets);
    chunksToAnalyze = chunks.filter((c) => sheetSet.has(contextGroup(c)));
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
  const contextProvenanceMap = buildContextProvenanceMap(chunks);

  // Process chunks with concurrency limit
  const results = await processWithConcurrency(chunksToAnalyze, concurrency, async (chunk) => {
    // Check resume cache
    if (resume && outputDir) {
      const fp = computeFingerprint(
        chunk.content,
        promptVersion,
        model,
        undefined,
        undefined,
        options?.providerOptions,
        budget.outputBudgetPolicy,
      );
      const cached = readIntermediateResult(
        outputDir,
        chunk.id,
        fp,
        provider.name,
        model,
        promptVersion,
      );
      if (cached) {
        checkpointHits++;
        contextsReused++;
        const result = enrichCanonicalProvenance(cached.result, chunk);
        return {
          result,
          usage: cached.usage as {
            inputTokens?: number;
            outputTokens?: number;
            totalTokens?: number;
          },
          reused: true,
          fingerprint: fp,
          repairs: 0,
          warnings: undefined,
          metrics: {
            requests: 0,
            schemaRepairs: 0,
            estimatedInputTokens: 0,
            maxEstimatedInputTokens: 0,
            initialOutputBudget: budget.maxOutputTokensPerRequest,
            finalOutputBudget: budget.maxOutputTokensPerRequest,
            outputBudgetEscalations: 0,
            finishReason: 'cached',
          },
        };
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
      analysis.result = enrichCanonicalProvenance(analysis.result, chunk);
      const fingerprint = computeFingerprint(
        chunk.content,
        promptVersion,
        model,
        undefined,
        undefined,
        options?.providerOptions,
        budget.outputBudgetPolicy,
      );
      if (outputDir) {
        writeIntermediateResult(
          outputDir,
          chunk.id,
          analysis.result,
          provider.name,
          model,
          analysis.usage as Record<string, unknown>,
          fingerprint,
          promptVersion,
        );
      }
      return { ...analysis, reused: false, fingerprint, repairs: analysis.warnings?.length ?? 0 };
    } catch (error) {
      contextsFailed++;
      throw error;
    } finally {
      activeConcurrency--;
    }
  });

  for (let i = 0; i < chunksToAnalyze.length; i++) {
    const { result, usage, warnings: repairWarnings } = results[i]!;

    chunkResults.push(result);
    if (!results[i]!.reused) aiRequests++;
    totalInputTokens += usage.inputTokens ?? 0;
    totalOutputTokens += usage.outputTokens ?? 0;
    schemaRepairs += results[i]!.repairs;
    if (!results[i]!.reused) {
      estimatedInputTokens += results[i]!.metrics.estimatedInputTokens;
      maxEstimatedTokensPerRequest = Math.max(
        maxEstimatedTokensPerRequest,
        results[i]!.metrics.maxEstimatedInputTokens,
      );
      totalOutputBudgetEscalations += results[i]!.metrics.outputBudgetEscalations;
      minInitialOutputBudget = Math.min(minInitialOutputBudget, results[i]!.metrics.initialOutputBudget);
      maxFinalOutputBudget = Math.max(maxFinalOutputBudget, results[i]!.metrics.finalOutputBudget);
    }

    // Collect repair warnings from schema repair attempts
    if (repairWarnings) {
      allWarnings.push(...repairWarnings);
    }

    // Validate provenance for all extracted objects
    validateChunkProvenance(
      result,
      validContextIds,
      contextSheetMap,
      allWarnings,
      contextProvenanceMap,
    );

    // Check confidence levels
    checkConfidence(result, allWarnings);
  }

  // ---- Pass 2: Global consolidation ---------------------------------------
  const sheetNames = sourceInput.contextGroups;
  let consolidationResult;
  let consolidationComplete = true;
  let consolidationRequests = 0;
  const consolidationFingerprint = computeConsolidationFingerprint(
    chunkResults.map((result, i) => ({ result, sourceFingerprint: results[i]!.fingerprint })),
    promptVersion,
    model,
    {
      maxContextsPerBatch: budget.maxContextsPerBatch,
      maxConsolidationItemsPerBatch: budget.maxConsolidationItemsPerBatch,
      maxConsolidationInputTokens: budget.maxConsolidationInputTokens,
    },
    options?.providerOptions,
  );

  try {
    const cachedConsolidation =
      resume && outputDir
        ? readConsolidationCheckpoint(
            outputDir,
            consolidationFingerprint,
            provider.name,
            model,
            promptVersion,
          )
        : null;
    if (cachedConsolidation) {
      consolidationResult = cachedConsolidation;
    } else {
      const cons = await consolidateHierarchically(
        chunkResults,
        sheetNames,
        provider,
        budget,
        contextSheetMap,
        aiRequests,
        outputDir
          ? {
              outputDir,
              resume,
              provider: provider.name,
              model,
              promptVersion,
              providerOptions: options?.providerOptions,
            }
          : undefined,
        options?.providerOptions,
      );
      consolidationResult = cons.result;
      consolidationRequests = cons.metrics.batchRequests + cons.metrics.globalRequests;
      aiRequests += consolidationRequests;
      totalInputTokens += cons.usage.inputTokens ?? 0;
      totalOutputTokens += cons.usage.outputTokens ?? 0;
      estimatedInputTokens += cons.metrics.estimatedInputTokens;
      maxEstimatedTokensPerRequest = Math.max(
        maxEstimatedTokensPerRequest,
        cons.metrics.maxEstimatedInputTokens,
      );
      if (outputDir)
        writeConsolidationCheckpoint(
          outputDir,
          consolidationFingerprint,
          consolidationResult,
          provider.name,
          model,
          promptVersion,
        );
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
  const { merged: dedupedEntities, warnings: mergeWarnings } = applyEntityMerge(
    orderedEntities,
    dedupMergeGroups,
  );
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
    semanticId: computeSemanticId(s.section.title, s.section.type ?? 'section', s.section.description, undefined),
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
    semanticId: computeSemanticId(e.entity.name, e.entity.type, e.entity.description, undefined),
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
    semanticId: computeSemanticId(f.flow.name, 'flow', f.flow.description, undefined),
  }));

  const finalRules: SemanticRule[] = orderedRules.map((r, i) => ({
    id: ruleGlobalIds[i]!,
    type: r.rule.type,
    statement: r.rule.statement,
    conditions: r.rule.conditions,
    effects: r.rule.effects,
    provenance: r.rule.provenance,
    confidence: r.rule.confidence,
    semanticId: computeSemanticId(r.rule.statement, r.rule.type, undefined, r.rule.statement),
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

  // Compute semanticId for relationships
  for (const rel of finalRelationships) {
    rel.semanticId = computeSemanticId(
      `${rel.sourceId}-${rel.targetId}`,
      rel.type,
      rel.description,
      undefined,
    );
  }

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
    provenance: chunks.map((c) => contextProvenance(c)),
    source: sourceInput.source,
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
  const lowConfCount = allSemanticObjects.filter(
    (o) => o.confidence < CONFIDENCE_THRESHOLD.MEDIUM,
  ).length;
  const withProvenance = allSemanticObjects.filter((o) => o.provenance.length > 0).length;
  const provCoverage =
    allSemanticObjects.length > 0
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

  const contextsExpected = chunksToAnalyze.length;
  const contextsCompleted = chunkResults.length;
  const allChunksSucceeded = contextsCompleted === contextsExpected && contextsFailed === 0;
  const status = allChunksSucceeded && consolidationComplete
    ? 'complete' as const
    : allChunksSucceeded || contextsCompleted > 0
      ? 'partial' as const
      : 'failed' as const;

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
    analysis: { ...analysis, consolidationComplete, contextsExpected, contextsCompleted },
    revisionFingerprint: undefined, // Computed below after assembly
  };

  // Compute revisionFingerprint for the entire IR
  semanticIR.revisionFingerprint = computeRevisionFingerprint(semanticIR);

  // ---- Write output -------------------------------------------------------
  if (outputDir) {
    const analysisManifest: AnalysisManifest = {
      schemaVersion: '1.0',
      status,
      source: { contextManifest: sourceInput.contextOrigin },
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

    writeOutput(
      outputDir,
      semanticIR,
      analysisManifest,
      chunkResults.map((r, i) => ({
        contextId: chunksToAnalyze[i]!.id,
        result: r,
        provider: provider.name,
        model: analysis.model,
        usage: {},
        fingerprint: results[i]!.fingerprint,
        promptVersion,
      })),
    );
  }

  return semanticIR;
}

// ---- Semantic fingerprint helpers -----------------------------------------

/**
 * Compute a content-addressable semanticId for a semantic object.
 * Hashes the content fields that define the object's meaning.
 */
function computeSemanticId(
  name: string,
  type: string,
  description: string | undefined,
  statement: string | undefined,
): string {
  const fields = [name, type, description ?? '', statement ?? ''].join('|||');
  return sha256(fields).slice(0, 16);
}

/**
 * Compute a revisionFingerprint for the entire Semantic IR.
 * This is a content-addressable hash of all semantic objects.
 */
function computeRevisionFingerprint(semanticIR: SemanticIR): string {
  const objects = [
    ...semanticIR.sections.map((s) => ({
      kind: 'section',
      id: s.id,
      title: s.title,
      description: s.description,
      type: s.type,
    })),
    ...semanticIR.entities.map((e) => ({
      kind: 'entity',
      id: e.id,
      name: e.name,
      type: e.type,
      description: e.description,
    })),
    ...semanticIR.flows.map((f) => ({
      kind: 'flow',
      id: f.id,
      name: f.name,
      description: f.description,
      steps: f.steps.map((s) => s.action),
    })),
    ...semanticIR.rules.map((r) => ({
      kind: 'rule',
      id: r.id,
      type: r.type,
      statement: r.statement,
    })),
    ...semanticIR.relationships.map((r) => ({
      kind: 'relationship',
      id: r.id,
      type: r.type,
      sourceId: r.sourceId,
      targetId: r.targetId,
    })),
  ];
  return sha256(JSON.stringify(objects)).slice(0, 16);
}

// ---- Helpers --------------------------------------------------------------

function validateChunkProvenance(
  result: ChunkSemanticResult,
  validContextIds: Set<string>,
  contextSheetMap: Map<string, string>,
  warnings: SemanticWarning[],
  contextProvenanceMap: ReturnType<typeof buildContextProvenanceMap>,
): void {
  for (const e of result.entities) {
    warnings.push(
      ...validateProvenanceArray(
        e.provenance,
        validContextIds,
        contextSheetMap,
        e.localId,
        contextProvenanceMap,
      ),
    );
  }
  for (const f of result.flows) {
    warnings.push(
      ...validateProvenanceArray(
        f.provenance,
        validContextIds,
        contextSheetMap,
        f.localId,
        contextProvenanceMap,
      ),
    );
    // Also validate individual flow step provenance
    for (const step of f.steps) {
      if (step.provenance && step.provenance.length > 0) {
        warnings.push(
          ...validateProvenanceArray(
            step.provenance,
            validContextIds,
            contextSheetMap,
            `${f.localId}:step-${step.order}`,
            contextProvenanceMap,
          ),
        );
      }
    }
  }
  for (const r of result.rules) {
    warnings.push(
      ...validateProvenanceArray(
        r.provenance,
        validContextIds,
        contextSheetMap,
        r.localId,
        contextProvenanceMap,
      ),
    );
  }
  for (const s of result.sections) {
    warnings.push(
      ...validateProvenanceArray(
        s.provenance,
        validContextIds,
        contextSheetMap,
        s.localId,
        contextProvenanceMap,
      ),
    );
  }
  for (const rel of result.relationships) {
    warnings.push(
      ...validateProvenanceArray(
        rel.provenance,
        validContextIds,
        contextSheetMap,
        rel.localId,
        contextProvenanceMap,
      ),
    );
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

function contextGroup(chunk: AnalyzerContextChunk): string {
  if ('sheet' in chunk) return chunk.sheet.name;
  return (
    chunk.location.segments.find((segment) => segment.kind === 'heading')?.value.toString() ??
    chunk.location.segments[0]?.value.toString() ??
    chunk.id
  );
}

function isCanonicalChunk(chunk: AnalyzerContextChunk): chunk is CanonicalAnalyzerChunk {
  return 'sourceId' in chunk.provenance;
}

function contextProvenance(chunk: AnalyzerContextChunk) {
  if (isCanonicalChunk(chunk)) {
    return {
      contextId: chunk.id,
      sourceId: chunk.provenance.sourceId,
      revisionId: chunk.provenance.revisionId,
      artifactId: chunk.provenance.artifactId,
      location: chunk.provenance.location,
    };
  }
  return {
    contextId: chunk.id,
    sheet: chunk.sheet.name,
    ranges: chunk.provenance.ranges,
  };
}

function enrichCanonicalProvenance(
  result: ChunkSemanticResult,
  chunk: AnalyzerContextChunk,
): ChunkSemanticResult {
  if (!isCanonicalChunk(chunk)) return result;
  const enrich = (provenance: ChunkSemanticResult['entities'][number]['provenance']) =>
    provenance.map((reference) => ({
      ...reference,
      contextId: chunk.id,
      sourceId: chunk.provenance.sourceId,
      revisionId: chunk.provenance.revisionId,
      artifactId: chunk.provenance.artifactId,
      location: chunk.provenance.location,
    }));
  return {
    ...result,
    sections: result.sections.map((item) => ({ ...item, provenance: enrich(item.provenance) })),
    entities: result.entities.map((item) => ({
      ...item,
      provenance: enrich(item.provenance),
      attributes: item.attributes?.map((attribute) => ({
        ...attribute,
        provenance: attribute.provenance ? enrich(attribute.provenance) : attribute.provenance,
      })),
    })),
    flows: result.flows.map((item) => ({
      ...item,
      provenance: enrich(item.provenance),
      steps: item.steps.map((step) => ({ ...step, provenance: enrich(step.provenance) })),
    })),
    rules: result.rules.map((item) => ({
      ...item,
      provenance: enrich(item.provenance),
      conditions: item.conditions?.map((condition) => ({
        ...condition,
        provenance: condition.provenance ? enrich(condition.provenance) : condition.provenance,
      })),
      effects: item.effects?.map((effect) => ({
        ...effect,
        provenance: effect.provenance ? enrich(effect.provenance) : effect.provenance,
      })),
    })),
    relationships: result.relationships.map((item) => ({
      ...item,
      provenance: enrich(item.provenance),
    })),
    unresolved: result.unresolved.map((item) => ({ ...item, provenance: enrich(item.provenance) })),
  };
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
