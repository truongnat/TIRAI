// ---------------------------------------------------------------------------
// Agentic Test Executor — deterministic step grounding
// ---------------------------------------------------------------------------

import type {
  AgenticAction,
  AgenticActionType,
  BrowserObservation,
  CandidateAction,
  ConfidenceClass,
  ObservedElement,
  StepGroundingRequest,
  StepGroundingResult,
} from '../models.js';

/**
 * Deterministic step grounding. Parsing and element matching are pure
 * functions of the request; there is no AI involvement. Any ambiguity or
 * missing data resolves to an unresolved result (fail-closed), never a guess.
 */
export function groundStep(request: StepGroundingRequest): StepGroundingResult {
  const base = {
    testCaseId: request.testCaseId,
    stepIndex: request.stepIndex,
    stepIntent: request.stepDescription,
  };
  const prior = request.previousFailure ? ` Previous failure: ${request.previousFailure}` : '';

  const actionType = parseActionType(request.stepDescription);
  if (!actionType) {
    return unresolved(base, 'STEP_UNPARSEABLE',
      `Step description does not contain a supported action verb: "${request.stepDescription}".${prior}`);
  }

  const candidateFor = (action: AgenticAction, reason: string): CandidateAction => ({ action, reason });

  if (actionType === 'navigate') {
    const url = extractNavigateUrl(request);
    if (!url) {
      return unresolved(base, 'NAVIGATION_TARGET_MISSING',
        `Navigate step does not provide a URL in stepTarget, stepInput, or a quoted value.${prior}`);
    }
    const action: AgenticAction = { type: 'navigate', url };
    return {
      ...base,
      action,
      candidateActions: [candidateFor(action, 'URL extracted deterministically from the step.')],
      confidence: 'high',
      reasoning: `Deterministic navigation to "${url}".${prior}`,
    };
  }

  if (actionType === 'observe') {
    const action: AgenticAction = { type: 'observe' };
    return {
      ...base,
      action,
      candidateActions: [candidateFor(action, 'Observe requires no target element.')],
      confidence: 'high',
      reasoning: `Deterministic observe step.${prior}`,
    };
  }

  // Element-bound actions: click, fill, select, check, uncheck, press, wait-for.
  const target = extractTargetLabel(request);
  if (!target) {
    return unresolved(base, 'TARGET_MISSING',
      `Action "${actionType}" requires a target element, but no target label was provided.${prior}`);
  }

  const match = matchElement(target, request.observation);
  if (match.elements.length === 0) {
    return unresolved(base, 'ELEMENT_NOT_FOUND',
      `No observed element matches target "${target}".${prior}`);
  }
  if (match.elements.length > 1) {
    const candidateActions = match.elements.map((element) =>
      candidateFor(
        { type: actionType, elementId: element.id },
        `Candidate ${element.id} (${describeElement(element)}) matches target "${target}".`,
      ));
    return {
      ...base,
      candidateActions,
      confidence: 'low',
      reasoning: `${match.elements.length} elements match target "${target}"; refusing to pick one.${prior}`,
      unresolvedReason: 'AMBIGUOUS_TARGET',
    };
  }

  const element = match.elements[0]!;
  const action = buildElementAction(actionType, element, request);
  const confidence: ConfidenceClass = match.exact ? 'high' : 'medium';
  return {
    ...base,
    action,
    candidateActions: [candidateFor(action, `${match.exact ? 'Exact' : 'Partial'} match for target "${target}" on ${describeElement(element)}.`)],
    confidence,
    reasoning: `Deterministically grounded "${actionType}" on ${describeElement(element)} via ${match.exact ? 'exact' : 'partial'} label match.${prior}`,
  };
}

// ---- Deterministic parsing ------------------------------------------------

const ACTION_PATTERNS: Array<{ type: AgenticActionType; pattern: RegExp }> = [
  { type: 'navigate', pattern: /\b(?:navigate|go\s+to|visit)\b|^\s*open\b/i },
  { type: 'uncheck', pattern: /\buncheck\b/i },
  { type: 'check', pattern: /\bcheck\b/i },
  { type: 'select', pattern: /\b(select|choose\s+option|pick)\b/i },
  // "press" precedes "fill": 'Press Enter' must not parse as a fill action.
  { type: 'press', pattern: /\b(press|hit)\b/i },
  { type: 'fill', pattern: /\b(fill|enter|type|input|set|write)\b/i },
  { type: 'wait-for', pattern: /\bwait[\s-]*(?:for)?\b/i },
  { type: 'observe', pattern: /\b(observe|verify\s+page|inspect)\b/i },
  { type: 'click', pattern: /\b(click|tap|submit)\b/i },
];

function parseActionType(description: string): AgenticActionType | undefined {
  for (const { type, pattern } of ACTION_PATTERNS) {
    if (pattern.test(description)) return type;
  }
  return undefined;
}

const QUOTED_PATTERN = /"([^"]+)"|'([^']+)'|“([^”]+)”|‘([^’]+)’/;

/** Extract the first quoted string from a free-form text, if present. */
export function extractQuotedText(text: string): string | undefined {
  const match = QUOTED_PATTERN.exec(text);
  const value = match?.[1] ?? match?.[2] ?? match?.[3] ?? match?.[4];
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Resolve the element label to match against the observation.
 * Order: explicit stepTarget (locator-like or label), quoted text in the
 * description, remaining description text after the leading action verb.
 */
function extractTargetLabel(request: StepGroundingRequest): string | undefined {
  const target = request.stepTarget?.trim();
  if (target) return target;
  const quoted = extractQuotedText(request.stepDescription);
  if (quoted) return quoted;
  const remainder = request.stepDescription
    .replace(/^\s*(?:navigate|go\s+to|visit|open|uncheck|check|select|choose\s+option|pick|fill|enter|type|input|set|write|press|hit|wait[\s-]*for|wait|observe|inspect|click|tap|submit)\b/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const normalized = remainder.replace(/^(?:on|in|into|the|a|an|of|button|field|element|link|checkbox|option|for)\s+/i, '').trim();
  return normalized || undefined;
}

function extractNavigateUrl(request: StepGroundingRequest): string | undefined {
  const candidates = [
    request.stepTarget?.trim(),
    request.stepInput?.trim(),
    extractQuotedText(request.stepDescription),
    /(?:https?:\/\/|\/)((?!["'\s])[^\s"']+)/i.exec(request.stepDescription)?.[0],
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (/^https?:\/\//i.test(candidate) || candidate.startsWith('/')) return candidate;
  }
  return undefined;
}

// ---- Deterministic element matching ---------------------------------------

function normalizeLabel(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Locator-like explicit targets may resolve ONLY against values an observed
 * element actually exposes: its observation id or its data-testid. No
 * selectors are ever invented.
 */
function explicitLocatorValue(target: string): string | undefined {
  const selectorMatch = /^(?:selector|data-testid)\s*:\s*(.+)$/i.exec(target.trim());
  if (selectorMatch) return selectorMatch[1]!.trim();
  if (target.startsWith('#')) return target.slice(1).trim();
  const attrMatch = /^\[\s*data-testid\s*=\s*["']?([^"'\]]+)["']?\s*\]$/i.exec(target.trim());
  if (attrMatch) return attrMatch[1]!.trim();
  return undefined;
}

function elementLabels(element: ObservedElement): string[] {
  return [element.accessibleName, element.label, element.placeholder, element.visibleText]
    .map(normalizeLabel)
    .filter((value) => value.length > 0);
}

function matchElement(
  target: string,
  observation: BrowserObservation,
): { elements: ObservedElement[]; exact: boolean } {
  const normalized = normalizeLabel(target);
  if (!normalized) return { elements: [], exact: false };

  const locatorValue = explicitLocatorValue(target);
  if (locatorValue !== undefined) {
    const byId = observation.elements.filter((element) => element.id === locatorValue);
    if (byId.length > 0) return { elements: byId, exact: true };
    const byTestId = observation.elements.filter(
      (element) => normalizeLabel(element.testId) === normalizeLabel(locatorValue),
    );
    return { elements: byTestId, exact: true };
  }

  const exact = observation.elements.filter(
    (element) => element.id === target.trim() || elementLabels(element).includes(normalized),
  );
  if (exact.length > 0) return { elements: exact, exact: true };

  // Heuristic fallback: containment in either direction. Still fail-closed
  // when more than one element qualifies.
  const partial = observation.elements.filter((element) =>
    elementLabels(element).some(
      (label) => label.includes(normalized) || (normalized.length >= 4 && normalized.includes(label)),
    ));
  return { elements: partial, exact: false };
}

function buildElementAction(
  type: AgenticActionType,
  element: ObservedElement,
  request: StepGroundingRequest,
): AgenticAction {
  const action: AgenticAction = { type, elementId: element.id };
  if (type === 'fill' || type === 'select') {
    const input = request.stepInput;
    if (input?.startsWith('secret://') || input?.startsWith('testdata://')) {
      action.valueSource = input;
    } else if (input !== undefined) {
      action.value = input;
    } else {
      const inline = extractQuotedText(request.stepDescription);
      if (inline !== undefined) action.value = inline;
    }
  }
  if (type === 'press') {
    action.key = request.stepInput?.trim() || extractQuotedText(request.stepDescription) || 'Enter';
  }
  return action;
}

function describeElement(element: ObservedElement): string {
  const name = element.accessibleName ?? element.label ?? element.placeholder ?? element.visibleText ?? '';
  return name ? `${element.role} "${name}" (${element.id})` : `${element.role} (${element.id})`;
}

function unresolved(
  base: { testCaseId: string; stepIndex: number; stepIntent: string },
  reason: string,
  reasoning: string,
): StepGroundingResult {
  return {
    ...base,
    candidateActions: [],
    confidence: 'low',
    reasoning,
    unresolvedReason: reason,
  };
}
