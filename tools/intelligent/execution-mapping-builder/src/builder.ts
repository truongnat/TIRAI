// Execution Mapping Builder — Main builder orchestrator.
//
// Transforms Test Case IR + Project Execution Metadata into Test Execution
// Mapping IR. Pipeline:
//
// 1. Classify executors (deterministic)
// 2. Generate mapping candidates (deterministic)
// 3. Validate candidates against catalogs (deterministic)
// 4. If unresolved remain and provider available → request AI candidates
// 5. Validate AI candidates against catalogs (deterministic)
// 6. Compute quality metrics
// 7. Return ExecutionMappingIR

import type {
  ExecutionMappingBuilderOptions,
  ExecutionMappingIR,
  ExecutionMappingResult,
  ExecutorCandidate,
  ExecutionCatalogReferences,
} from './models.js';
import { classifyAll } from './classifier/classifier.js';
import { generateExecutorCandidate } from './candidates/candidates.js';
import { validateAllCandidates } from './validation/validation.js';
import { UICatalogResolver, createEmptyCatalog } from './catalog/catalog.js';
import { BindingResolver } from './bindings/bindings.js';
import { requestAICandidates } from './ai/ai-layer.js';
import { computeQuality } from './quality/quality.js';
import { CheckpointStore, createFingerprint } from './checkpoint.js';
import { ExecutionMappingError } from './errors.js';

// ---- Build execution mapping -----------------------------------------------

export async function buildExecutionMapping(
  options: ExecutionMappingBuilderOptions,
): Promise<ExecutionMappingResult> {
  const {
    testCases,
    uiCatalog,
    apiCatalog,
    dbCatalog,
    bindingsCatalog,
    semanticEntities,
    provider,
    providerName,
    resume,
    checkpointDir,
  } = options;

  // Validate inputs
  if (!testCases || testCases.length === 0) {
    throw new ExecutionMappingError('EMB_INVALID_TEST_CASE', 'No test cases provided');
  }

  // Check for duplicate test case IDs
  const ids = new Set<string>();
  for (const tc of testCases) {
    if (ids.has(tc.id)) {
      throw new ExecutionMappingError('EMB_DUPLICATE_MAPPING', `Duplicate test case ID: ${tc.id}`);
    }
    ids.add(tc.id);
  }

  // Setup resolvers
  const catalog = uiCatalog
    ? new UICatalogResolver(uiCatalog)
    : new UICatalogResolver(createEmptyCatalog());
  const bindings = new BindingResolver(bindingsCatalog ?? null);

  // Checkpoint / resume
  const checkpointReused = false;
  let checkpointStore: CheckpointStore | null = null;
  let fingerprint = '';

  if (checkpointDir) {
    checkpointStore = new CheckpointStore(checkpointDir);
    fingerprint = createFingerprint({
      testCases,
      uiCatalog,
      bindingsCatalog,
      providerName,
    });

    if (resume) {
      const saved = checkpointStore.loadMapping(fingerprint);
      if (saved) {
        return {
          mapping: saved,
          aiCalls: 0,
          tokensUsed: 0,
          repairs: 0,
          checkpointReused: true,
        };
      }
    }
  }

  // Step 1: Classify executors
  const classifications = classifyAll(testCases, semanticEntities);

  // Step 2: Generate deterministic candidates
  const allCandidates: ExecutorCandidate[] = [];

  for (const tc of testCases) {
    const classification = classifications.find(c => c.testCaseId === tc.id);
    if (!classification) continue;

    // Skip AI for deterministic cases (spec §36)
    const candidate = generateExecutorCandidate(
      tc,
      classification.executorType,
      catalog,
      bindings,
    );
    allCandidates.push(candidate);
  }

  // Save candidates checkpoint
  if (checkpointStore) {
    checkpointStore.saveCandidates(allCandidates, fingerprint);
  }

  // Step 3: Validate candidates
  const validated = validateAllCandidates(testCases, allCandidates, catalog, bindings);
  const { mappings } = validated;
  let allUnresolved = [...validated.allUnresolved];

  // Step 4: If unresolved remain and provider available → AI enrichment
  let aiCalls = 0;
  let tokensUsed = 0;
  let repairs = 0;

  const unresolvedTestIds = new Set(allUnresolved.map(u => u.testCaseId));
  const unresolvedCases = testCases.filter(tc => unresolvedTestIds.has(tc.id));

  if (unresolvedCases.length > 0 && provider) {
    try {
      const aiResult = await requestAICandidates(provider, unresolvedCases, catalog);
      aiCalls++;
      tokensUsed += aiResult.tokensUsed;
      repairs += aiResult.repairs;

      // Validate AI candidates against catalogs
      const aiValidated = validateAllCandidates(
        unresolvedCases,
        aiResult.candidates,
        catalog,
        bindings,
      );

      // Merge: replace unresolved mappings with AI-validated ones
      const mappedIds = new Set(mappings.map(m => m.testCaseId));
      for (const aiMapping of aiValidated.mappings) {
        if (!mappedIds.has(aiMapping.testCaseId)) {
          mappings.push(aiMapping);
        }
      }

      // Keep unresolved that AI couldn't resolve
      const resolvedByAI = new Set(aiValidated.mappings.map(m => m.testCaseId));
      allUnresolved = allUnresolved.filter(u => !resolvedByAI.has(u.testCaseId));
      allUnresolved.push(...aiValidated.allUnresolved);
    } catch {
      // AI failed — keep deterministic results only
    }
  }

  // Step 5: Build catalog references
  const catalogs: ExecutionCatalogReferences = {
    uiCatalog,
    apiResources: apiCatalog,
    dbEntities: dbCatalog,
    bindingsCatalog,
  };

  // Step 6: Compute quality
  const quality = computeQuality(testCases, mappings, allUnresolved);

  // Step 7: Build final IR
  const mapping: ExecutionMappingIR = {
    schemaVersion: '1.0',
    testMappings: mappings,
    unresolved: allUnresolved,
    catalogs,
    quality,
  };

  // Save final checkpoint
  if (checkpointStore) {
    checkpointStore.saveMapping(mapping, fingerprint);
  }

  return {
    mapping,
    aiCalls,
    tokensUsed,
    repairs,
    checkpointReused,
  };
}
