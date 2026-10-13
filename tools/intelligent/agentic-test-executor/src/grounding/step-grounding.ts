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

  // Element-bound actions: click, fill, select, check, uncheck, wait-for.
  // `press` may be key-only (target names a keyboard key like "Enter" →
  // focused element) or element-bound ("press the Save button").
  if (actionType === 'press') {
    const KEY_NAMES = /^(enter|tab|escape|backspace|delete|arrowup|arrowdown|arrowleft|arrowright|home|end|pageup|pagedown|f([1-9]|1[0-2])|control|alt|shift|meta)$/i;
    const KEY_MAP: Record<string, string> = { enter: 'Enter', tab: 'Tab', escape: 'Escape', backspace: 'Backspace', delete: 'Delete', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', control: 'Control', alt: 'Alt', shift: 'Shift', meta: 'Meta' };
    const canonicalKey = (raw: string | undefined): string | undefined => {
      if (!raw || !KEY_NAMES.test(raw)) return undefined;
      const lower = raw.toLowerCase();
      return KEY_MAP[lower] ?? (/^f\d+$/i.test(lower) ? lower.toUpperCase() : undefined);
    };
    // Key wins only when the step has no element target, or the target itself names a key.
    const keyName = canonicalKey(request.stepInput?.trim() || extractQuotedText(request.stepDescription))
      ?? canonicalKey(request.stepTarget?.trim());
    if (keyName && (!request.stepTarget?.trim() || canonicalKey(request.stepTarget.trim()))) {
      // Key-only press unless the description names a distinct element
      // (e.g. 'Press Enter in "Search"' should bind the Search field).
      const label = extractTargetLabel(request) ?? extractQuotedText(request.stepDescription);
      const elementMatch = label ? matchElement(label, request.observation) : undefined;
      const bound = elementMatch && elementMatch.elements.length === 1 ? elementMatch.elements[0] : undefined;
      const action: AgenticAction = bound
        ? { type: 'press', key: keyName, elementId: bound.id }
        : { type: 'press', key: keyName };
      return {
        ...base,
        action,
        candidateActions: [candidateFor(action, bound
          ? `Key press "${keyName}" bound to ${bound.id}.`
          : `Key-only press of "${keyName}" on the focused element.`)],
        confidence: 'high',
        reasoning: `Press "${keyName}" resolved as a keyboard key${bound ? ` on element ${bound.id}` : ' with no element target'}.${prior}`,
      };
    }
  }

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
    // Role-compatible disambiguation: an action on a label-bearing form field
    // should bind the control, not its <label> sibling. If exactly one match
    // supports the action's role, prefer it; otherwise stay fail-closed.
    const COMPATIBLE_ROLES: Record<string, string[]> = {
      click: ['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem'],
      fill: ['textbox', 'combobox'],
      select: ['combobox'],
      check: ['checkbox'],
      uncheck: ['checkbox'],
      'wait-for': [],
      hover: [],
      press: [],
    };
    const compatible = COMPATIBLE_ROLES[actionType] ?? [];
    const narrowed = compatible.length > 0
      ? match.elements.filter((element) => compatible.includes(element.role))
      : match.elements;
    if (narrowed.length === 1) {
      const element = narrowed[0]!;
      const action = buildElementAction(actionType, element, request);
      return {
        ...base,
        action,
        candidateActions: [candidateFor(action, `Resolved to role-compatible ${describeElement(element)} out of ${match.elements.length} label matches.`)],
        confidence: 'medium',
        reasoning: `Multiple elements matched "${target}", but only ${describeElement(element)} is role-compatible with "${actionType}".${prior}`,
      };
    }
    if (narrowed.length > 0) match.elements.splice(0, match.elements.length, ...narrowed);
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
  { type: 'hover', pattern: /\bhover\b/i },
];

// Quoted spans are target labels/values, not verbs — strip them before matching
// so e.g. hover steps referencing "Write report" don't misfire as fill.
const STRIP_QUOTED = /"[^"]+"|'[^']+'|“[^”]+”|‘[^’]+’/g;

function parseActionType(description: string): AgenticActionType | undefined {
  const probe = description.replace(STRIP_QUOTED, ' ');
  for (const { type, pattern } of ACTION_PATTERNS) {
    if (pattern.test(probe)) return type;
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
