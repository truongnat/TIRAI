// Execution Mapping Builder — Main builder orchestrator.
//
// Transforms Test Case IR + Project Execution Metadata into Test Execution
// Mapping IR. Deterministic pipeline:
//
// 1. Classify executors
// 2. Generate mapping candidates
// 3. Validate candidates against catalogs
// 4. Compute quality metrics
// 5. Return ExecutionMappingIR

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
  const allUnresolved = [...validated.allUnresolved];

  // Step 4: Build catalog references
  const catalogs: ExecutionCatalogReferences = {
    uiCatalog,
    apiResources: apiCatalog,
    dbEntities: dbCatalog,
    bindingsCatalog,
  };

  // Step 5: Compute quality
  const quality = computeQuality(testCases, mappings, allUnresolved);

  // Step 6: Build final IR
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
    aiCalls: 0,
    tokensUsed: 0,
    repairs: 0,
    checkpointReused,
  };
}
