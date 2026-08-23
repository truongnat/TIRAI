// Execution Mapping Builder — Executor classifier.
//
// Classifies each Test Case into an executor type based on evidence from:
// - TestCase.type (explicit)
// - automation.suggestedExecutor
// - verificationType signals
// - step/expectedResult patterns
// - semantic entity references
//
// Classification is evidence-based. Unknown evidence → unresolved, NOT default UI.

import type {
  TestCase,
  ExecutorClassification,
  MappingSource,
  SemanticEntity,
} from '../models.js';

// Executor type for classification includes 'unknown' (from TestCase.type)
type ClassifiedExecutorType = 'ui' | 'api' | 'database' | 'integration' | 'manual' | 'unknown';

// ---- Classification signals -----------------------------------------------

interface ClassificationSignals {
  ui: number;
  api: number;
  database: number;
  integration: number;
  manual: number;
}

// ---- Classify a single Test Case ------------------------------------------

export function classifyExecutor(
  testCase: TestCase,
  semanticEntities?: SemanticEntity[],
): ExecutorClassification {
  const signals: ClassificationSignals = { ui: 0, api: 0, database: 0, integration: 0, manual: 0 };
  const evidence: string[] = [];
  const source: MappingSource[] = [];
  // Signal 1: Explicit type from TestCase.type
  if (testCase.type !== 'unknown') {
    signals[testCase.type] += 10;
    evidence.push(`explicit-type:${testCase.type}`);
    source.push({ type: 'explicit', reference: `testCase.${testCase.id}.type` });
  }

  // Signal 2: Automation suggestedExecutor
  if (testCase.automation.suggestedExecutor) {
    const suggested = testCase.automation.suggestedExecutor;
    if (suggested === 'ui') signals.ui += 5;
    else if (suggested === 'api') signals.api += 5;
    else if (suggested === 'database') signals.database += 5;
    else if (suggested === 'hybrid') signals.integration += 5;
    evidence.push(`suggested-executor:${suggested}`);
    source.push({ type: 'explicit', reference: `testCase.${testCase.id}.automation` });
  }

  // Signal 3: verificationType patterns
  for (const er of testCase.expectedResults) {
    if (er.verificationType === 'ui') signals.ui += 3;
    else if (er.verificationType === 'api') signals.api += 3;
    else if (er.verificationType === 'database') signals.database += 3;
    else if (er.verificationType === 'state') signals.integration += 1;
  }

  // Signal 4: Step keyword heuristics (deterministic, not AI)
  for (const step of testCase.steps) {
    const text = `${step.action} ${step.target ?? ''}`.toLowerCase();
    if (/\b(click|navigate|page|screen|button|form|input|field)\b/.test(text)) signals.ui += 1;
    if (/\b(api|endpoint|request|response|http|get|post|put|delete)\b/.test(text)) signals.api += 1;
    if (/\b(database|table|column|row|query|sql|insert|select)\b/.test(text)) signals.database += 1;
  }

  // Signal 5: Semantic entity type references
  if (semanticEntities) {
    for (const entity of semanticEntities) {
      if (entity.type === 'ui-component' || entity.type === 'page-object') signals.ui += 2;
      if (entity.type === 'api') signals.api += 2;
      if (entity.type === 'db-table') signals.database += 2;
    }
  }

  // Determine winner
  const max = Math.max(signals.ui, signals.api, signals.database, signals.integration, signals.manual);
  if (max === 0) {
    return {
      testCaseId: testCase.id,
      executorType: 'unknown',
      confidence: 0,
      evidence: ['no-signals'],
      source: [],
    };
  }

  // Check for tie → integration or unresolved
  const winners = Object.entries(signals).filter(([, v]) => v === max);
  if (winners.length > 1) {
    return {
      testCaseId: testCase.id,
      executorType: 'integration',
      confidence: 0.5,
      evidence: [...evidence, `multi-executor:${winners.map(([k]) => k).join(',')}`],
      source: [...source, { type: 'semantic-evidence', reference: 'multi-executor-detected' }],
    };
  }

  const winner = winners[0][0] as ClassifiedExecutorType;
  const total = Object.values(signals).reduce((a, b) => a + b, 0);
  const confidence = total > 0 ? max / total : 0;

  return {
    testCaseId: testCase.id,
    executorType: winner,
    confidence: Math.round(confidence * 100) / 100,
    evidence,
    source,
  };
}

// ---- Classify all Test Cases ----------------------------------------------

export function classifyAll(
  testCases: TestCase[],
  semanticEntities?: SemanticEntity[],
): ExecutorClassification[] {
  return testCases.map(tc => classifyExecutor(tc, semanticEntities));
}
