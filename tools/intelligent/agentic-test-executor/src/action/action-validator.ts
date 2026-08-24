// ---------------------------------------------------------------------------
// Agentic Test Executor — action validator
// ---------------------------------------------------------------------------

import type { AgenticAction, BrowserObservation, AgentExecutionPolicy } from '../models.js';

export interface ActionValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateAction(
  action: AgenticAction,
  observation: BrowserObservation,
  policy: AgentExecutionPolicy,
  metrics: { navigationActions: number; totalActions: number },
): ActionValidationResult {
  if (action.type === 'navigate') {
    if (!action.url) {
      return { valid: false, reason: 'Navigate action requires url' };
    }
    if (metrics.navigationActions >= policy.maxNavigationActions) {
      return { valid: false, reason: 'Navigation budget exceeded' };
    }
    if (isAbsoluteExternalUrl(action.url)) {
      return { valid: false, reason: `Navigation to external URL not allowed: ${action.url}` };
    }
    return { valid: true };
  }

  if (action.type === 'observe') {
    return { valid: true };
  }

  if (!action.elementId) {
    return { valid: false, reason: `Action "${action.type}" requires elementId` };
  }

  const element = observation.elements.find((e) => e.id === action.elementId);
  if (!element) {
    return { valid: false, reason: `Element ${action.elementId} not found in current observation (stale)` };
  }

  if (element.visible === false) {
    return { valid: false, reason: `Element ${action.elementId} is not visible` };
  }
  if (!element.enabled) {
    return { valid: false, reason: `Element ${action.elementId} is disabled` };
  }

  const role = element.role.toLowerCase();
  if ((action.type === 'fill' || action.type === 'select') && !['textbox', 'combobox'].includes(role)) {
    return { valid: false, reason: `Action "${action.type}" is incompatible with role ${element.role}` };
  }
  if (action.type === 'click' && !['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem'].includes(role)) {
    return { valid: false, reason: `Action "click" is incompatible with role ${element.role}` };
  }
  if ((action.type === 'check' || action.type === 'uncheck') && role !== 'checkbox') {
    return { valid: false, reason: `Action "${action.type}" is incompatible with role ${element.role}` };
  }

  if (action.type === 'fill' || action.type === 'select') {
    if (!action.value && action.value !== '') {
      return { valid: false, reason: `Action "${action.type}" requires value` };
    }
  }

  if (action.type === 'press') {
    if (!action.key) {
      return { valid: false, reason: 'Press action requires key' };
    }
  }

  return { valid: true };
}

function isAbsoluteExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
