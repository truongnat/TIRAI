// Execution Mapping Builder — Mapping candidates.
//
// Generates step and assertion mapping candidates from Test Case IR using
// deterministic matching against trusted catalogs. AI may propose additional
// candidates, but ALL candidates are validated against catalogs before becoming
// final mappings.

import type {
  TestCase,
  TestStep,
  ExpectedResult,
  UIActionType,
  UIAssertionType,
  StepMappingCandidate,
  AssertionMappingCandidate,
  ExecutorCandidate,
  MappingTrust,
} from '../models.js';
import type { UICatalogResolver } from '../catalog/catalog.js';
import type { BindingResolver } from '../bindings/bindings.js';

// ---- Supported UI actions (spec §17) ---------------------------------------

const SUPPORTED_UI_ACTIONS: ReadonlySet<UIActionType> = new Set([
  'navigate', 'click', 'fill', 'type', 'select', 'check', 'uncheck',
  'press', 'wait', 'focus', 'blur', 'scroll', 'noop',
]);

// ---- Supported UI assertions (spec §49) ------------------------------------

const SUPPORTED_UI_ASSERTIONS: ReadonlySet<UIAssertionType> = new Set([
  'visible', 'hidden', 'enabled', 'disabled', 'checked', 'unchecked',
  'text-equals', 'text-contains', 'value-equals', 'url-equals', 'url-contains',
  'element-count', 'attribute-equals', 'page-title', 'exists', 'not-exists',
]);

// ---- Action keyword mapping (deterministic) --------------------------------

const ACTION_KEYWORDS: Array<{ pattern: RegExp; action: UIActionType }> = [
  { pattern: /\b(navigate|go\s+to|open|visit)\b/i, action: 'navigate' },
  { pattern: /\b(click|press|tap|submit)\b/i, action: 'click' },
  { pattern: /\b(enter|type|input|fill|set)\b/i, action: 'fill' },
  { pattern: /\b(select|choose|pick)\b/i, action: 'select' },
  { pattern: /\b(check|tick|enable)\b/i, action: 'check' },
  { pattern: /\b(uncheck|untick|disable)\b/i, action: 'uncheck' },
  { pattern: /\b(wait|pause|delay)\b/i, action: 'wait' },
  { pattern: /\b(focus|activate)\b/i, action: 'focus' },
  { pattern: /\b(blur|deactivate)\b/i, action: 'blur' },
  { pattern: /\b(scroll|scroll\s+to)\b/i, action: 'scroll' },
  { pattern: /\b(observe|verify|check|confirm)\b/i, action: 'noop' },
];

// ---- Assertion keyword mapping (deterministic) -----------------------------

const ASSERTION_KEYWORDS: Array<{ pattern: RegExp; assertion: UIAssertionType }> = [
  { pattern: /\b(is\s+displayed|is\s+visible|appears|shows)\b/i, assertion: 'visible' },
  { pattern: /\b(is\s+hidden|disappears|not\s+visible)\b/i, assertion: 'hidden' },
  { pattern: /\b(is\s+enabled|not\s+disabled)\b/i, assertion: 'enabled' },
  { pattern: /\b(is\s+disabled|cannot|greyed)\b/i, assertion: 'disabled' },
  { pattern: /\b(is\s+checked|is\s+selected)\b/i, assertion: 'checked' },
  { pattern: /\b(is\s+unchecked|is\s+not\s+selected)\b/i, assertion: 'unchecked' },
  { pattern: /\b(text\s+equals|text\s+is|says|displays)\b/i, assertion: 'text-contains' },
  { pattern: /\b(text\s+contains|includes|has\s+text)\b/i, assertion: 'text-contains' },
  { pattern: /\b(value\s+equals|value\s+is)\b/i, assertion: 'value-equals' },
  { pattern: /\b(url\s+is|url\s+equals|navigated\s+to)\b/i, assertion: 'url-contains' },
  { pattern: /\b(url\s+contains|url\s+includes)\b/i, assertion: 'url-contains' },
  { pattern: /\b(count|number\s+of)\b/i, assertion: 'element-count' },
  { pattern: /\b(not\s+exists|not\s+present|absent)\b/i, assertion: 'not-exists' },
  { pattern: /\b(exists|present)\b/i, assertion: 'exists' },
  { pattern: /\b(title\s+is|page\s+title)\b/i, assertion: 'page-title' },
];

// ---- Is action supported? --------------------------------------------------

export function isSupportedAction(action: string): action is UIActionType {
  return SUPPORTED_UI_ACTIONS.has(action as UIActionType);
}

// ---- Is assertion supported? -----------------------------------------------

export function isSupportedAssertion(assertion: string): assertion is UIAssertionType {
  return SUPPORTED_UI_ASSERTIONS.has(assertion as UIAssertionType);
}

// ---- Infer action from step text (deterministic) ---------------------------

export function inferActionFromStep(step: TestStep): UIActionType | null {
  const text = `${step.action} ${step.target ?? ''} ${step.input ?? ''}`;
  for (const { pattern, action } of ACTION_KEYWORDS) {
    if (pattern.test(text)) return action;
  }
  return null;
}

// ---- Infer assertion from expected result (deterministic) ------------------

export function inferAssertionFromResult(er: ExpectedResult): UIAssertionType | null {
  const text = er.description;
  for (const { pattern, assertion } of ASSERTION_KEYWORDS) {
    if (pattern.test(text)) return assertion;
  }
  return null;
}

// ---- Generate step mapping candidates (deterministic) ----------------------

export function generateStepCandidates(
  testCase: TestCase,
  catalog: UICatalogResolver,
  bindings: BindingResolver,
): StepMappingCandidate[] {
  const candidates: StepMappingCandidate[] = [];

  for (const step of testCase.steps) {
    const action = inferActionFromStep(step);
    if (!action) continue;

    // Try to find target in catalog
    let targetLogicalName: string | undefined;
    let trust: MappingTrust = 'catalog';

    if (step.target) {
      const lookup = catalog.lookup(step.target);
      if (lookup.found && lookup.element) {
        targetLogicalName = lookup.element.logicalName;
        trust = 'catalog';
      } else {
        // Target not found in catalog — still create candidate but mark trust
        targetLogicalName = step.target;
        trust = 'ai-inferred';
      }
    }

    // Try to find value binding
    let valueBinding: string | undefined;
    if (step.input) {
      // Check if input references a known binding
      if (bindings.isKnown(step.input)) {
        valueBinding = step.input;
      } else if (step.input.startsWith('runtime.')) {
        valueBinding = step.input;
      }
    }

    candidates.push({
      stepOrder: step.order,
      action,
      targetLogicalName,
      valueBinding,
      trust,
      evidence: [`step:${step.order}`, `action:${action}`],
    });
  }

  return candidates;
}

// ---- Generate assertion mapping candidates (deterministic) -----------------

export function generateAssertionCandidates(
  testCase: TestCase,
  catalog: UICatalogResolver,
  _bindings: BindingResolver,
): AssertionMappingCandidate[] {
  const candidates: AssertionMappingCandidate[] = [];

  for (let i = 0; i < testCase.expectedResults.length; i++) {
    const er = testCase.expectedResults[i];
    const assertionType = inferAssertionFromResult(er);
    if (!assertionType) continue;

    // Try to find target in catalog
    let targetLogicalName: string | undefined;
    let trust: MappingTrust = 'catalog';

    if (er.target) {
      const lookup = catalog.lookup(er.target);
      if (lookup.found && lookup.element) {
        targetLogicalName = lookup.element.logicalName;
        trust = 'catalog';
      } else {
        targetLogicalName = er.target;
        trust = 'ai-inferred';
      }
    }

    candidates.push({
      expectedResultIndex: i,
      assertionType,
      targetLogicalName,
      trust,
      evidence: [`expectedResult:${i}`, `assertion:${assertionType}`],
    });
  }

  return candidates;
}

// ---- Generate full executor candidate (deterministic) ----------------------

export function generateExecutorCandidate(
  testCase: TestCase,
  executorType: string,
  catalog: UICatalogResolver,
  bindings: BindingResolver,
): ExecutorCandidate {
  const stepCandidates = generateStepCandidates(testCase, catalog, bindings);
  const assertionCandidates = generateAssertionCandidates(testCase, catalog, bindings);

  return {
    testCaseId: testCase.id,
    executorType: executorType as ExecutorCandidate['executorType'],
    stepCandidates,
    assertionCandidates,
    trust: 'code-derived',
    confidence: 0.8,
    evidence: [`deterministic-mapping:${testCase.id}`],
  };
}
