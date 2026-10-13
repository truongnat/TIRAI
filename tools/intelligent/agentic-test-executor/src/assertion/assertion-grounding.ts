// ---------------------------------------------------------------------------
// Agentic Test Executor — deterministic assertion grounding
// ---------------------------------------------------------------------------

import type {
  AgenticAssertionType,
  AssertionGroundingRequest,
  AssertionGroundingResult,
  ConfidenceClass,
  ObservedElement,
} from '../models.js';
import { extractQuotedText } from '../grounding/step-grounding.js';

/**
 * Deterministic assertion grounding. `expectedDescription` is parsed into the
 * canonical assertion types; anything unparseable resolves to
 * ASSERTION_UNPARSEABLE (fail-closed), never a guess.
 */
export function groundAssertion(request: AssertionGroundingRequest): AssertionGroundingResult {
  const description = request.expectedDescription;
  const base = { testCaseId: request.testCaseId, expectedResultIndex: request.expectedResultIndex };
  const quoted = extractQuotedText(description);

  const urlKind = matchUrlAssertion(description);
  if (urlKind) {
    const expectedValue = quoted ?? extractUrlToken(description);
    if (!expectedValue) return unparseable(base, `URL assertion needs an expected value: "${description}".`);
    return resolved(base, urlKind, { expectedValue },
      `Deterministic ${urlKind} on "${expectedValue}".`, 'high');
  }

  const titleKind = matchTitleAssertion(description);
  if (titleKind) {
    if (!quoted) return unparseable(base, `Title assertion needs quoted expected text: "${description}".`);
    return resolved(base, titleKind, { expectedValue: quoted },
      `Deterministic ${titleKind} on "${quoted}".`, 'high');
  }

  if (/\b(?:not\s+(?:be\s+)?(?:visible|displayed|present|shown)|absent|removed|disappear(?:s|ed)?|no\s+longer\s+visible)\b/i.test(description)) {
    const element = matchAssertionElement(description, quoted, request.observation.elements);
    if (element.ambiguous) {
      return unparseable(base, `Multiple elements match "${element.target}"; cannot resolve element-absent.`);
    }
    return resolved(base, 'element-absent', { elementId: element.element?.id },
      element.element
        ? `Element-absent on matched element ${element.element.id}.`
        : 'No observed element matches; absence is satisfied.', 'high');
  }

  if (/\b(?:element|button|link|field|input|checkbox|control)\b.*\b(?:is\s+)?(?:visible|displayed|present|shown|exists?)\b/i.test(description)
    || /\b(?:visible|displayed|present|shown)\b.*\b(?:element|button|link|field|input|checkbox|control)\b/i.test(description)) {
    const element = matchAssertionElement(description, quoted, request.observation.elements);
    if (!element.element) {
      return unparseable(base, `No unique element matches "${element.target}" for element-visible.`);
    }
    return resolved(base, 'element-visible', { elementId: element.element.id },
      `Element-visible resolved to ${element.element.id} via deterministic match.`, element.exact ? 'high' : 'medium');
  }

  if (/\b(?:value|field|input)\b.*\b(?:equals?|=|is)\b/i.test(description) && quoted) {
    const element = matchAssertionElement(description, undefined, request.observation.elements);
    return resolved(base, 'value-equals', { elementId: element.element?.id, expectedValue: quoted },
      element.element
        ? `Value-equals on ${element.element.id} expecting "${quoted}".`
        : `Value-equals expecting "${quoted}" (no element bound).`, element.element ? 'high' : 'medium');
  }

  // Default: text-visible requires an explicit expected text. A quoted value is
  // preferred; "text X is displayed" style is accepted when a text token follows
  // "text"/"message".
  if (quoted) {
    return resolved(base, 'text-visible', { expectedValue: quoted },
      `Text-visible on quoted text "${quoted}".`, 'high');
  }
  const bare = /(?:text|message|heading)\s+(.+?)\s+(?:is\s+)?(?:visible|displayed|shown|present)\s*$/i.exec(description);
  if (bare?.[1]) {
    const expectedValue = bare[1].trim();
    if (expectedValue) {
      return resolved(base, 'text-visible', { expectedValue },
        `Text-visible on extracted text "${expectedValue}".`, 'medium');
    }
  }

  return unparseable(base, `Cannot deterministically parse expected result: "${description}".`);
}

function matchUrlAssertion(description: string): Extract<AgenticAssertionType, 'url-contains' | 'url-equals'> | undefined {
  if (!/\b(?:url|address|location|route|path)\b/i.test(description)) return undefined;
  return /\b(?:equals?|=|is\s+exactly|ends\s+with\s+exactly)\b/i.test(description) ? 'url-equals' : 'url-contains';
}

function matchTitleAssertion(description: string): Extract<AgenticAssertionType, 'title-contains' | 'title-equals'> | undefined {
  if (!/\btitle\b/i.test(description)) return undefined;
  return /\b(?:equals?|=|is\s+exactly)\b/i.test(description) ? 'title-equals' : 'title-contains';
}

function extractUrlToken(description: string): string | undefined {
  const match = /((?:https?:\/\/|\/)[^\s"']+)/i.exec(description);
  return match?.[1];
}

interface AssertionElementMatch {
  element?: ObservedElement;
  exact: boolean;
  ambiguous: boolean;
  target: string;
}
function matchAssertionElement(
  description: string,
  quoted: string | undefined,
  elements: ObservedElement[],
): AssertionElementMatch {
  const labels = (element: ObservedElement): string[] =>
    [element.accessibleName, element.label, element.placeholder, element.visibleText]
      .map((value) => value?.replace(/\s+/g, ' ').trim().toLowerCase())
      .filter((value): value is string => !!value);

  const target = quoted?.replace(/\s+/g, ' ').trim().toLowerCase();
  if (target) {
    const exact = elements.filter((element) => labels(element).includes(target));
    if (exact.length === 1) return { element: exact[0], exact: true, ambiguous: false, target };
    if (exact.length > 1) return { exact: true, ambiguous: true, target };
    const partial = elements.filter((element) =>
      labels(element).some((label) => label.includes(target) || (target.length >= 4 && target.includes(label))));
    if (partial.length === 1) return { element: partial[0], exact: false, ambiguous: false, target };
    return { exact: false, ambiguous: partial.length > 1, target };
  }

  // Unquoted: bind the element whose label literally appears in the description.
  const normalizedDescription = description.replace(/\s+/g, ' ').toLowerCase();
  const mentioned = elements.filter((element) =>
    labels(element).some((label) => label.length >= 3 && normalizedDescription.includes(label)));
  if (mentioned.length === 1) return { element: mentioned[0], exact: true, ambiguous: false, target: normalizedDescription };
  return { exact: false, ambiguous: mentioned.length > 1, target: normalizedDescription };
}

function resolved(
  base: { testCaseId: string; expectedResultIndex: number },
  assertionType: AgenticAssertionType,
  extra: { elementId?: string; expectedValue?: string },
  reasoning: string,
  confidence: ConfidenceClass,
): AssertionGroundingResult {
  return { ...base, assertionType, ...extra, confidence, reasoning };
}

function unparseable(
  base: { testCaseId: string; expectedResultIndex: number },
  reasoning: string,
): AssertionGroundingResult {
  return {
    ...base,
    assertionType: 'text-visible',
    confidence: 'low',
    reasoning,
    unresolvedReason: 'ASSERTION_UNPARSEABLE',
  };
}
