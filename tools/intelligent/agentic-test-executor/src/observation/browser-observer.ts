// ---------------------------------------------------------------------------
// Agentic Test Executor — browser observer
// ---------------------------------------------------------------------------

import type { BrowserPage } from 'ui-executor';
import type { BrowserObservation, ObservedElement, RawObservationData } from '../models.js';

const OBSERVATION_BUDGET = 50;

const INTERACTIVE_SELECTORS = 'button, a[href], input, select, textarea, [role=button], [role=link], [role=textbox], [role=checkbox], [role=radio], [role=combobox], [role=tab], [role=menuitem], [tabindex]';
const HEADING_TAGS = 'h1, h2, h3';

const OBSERVATION_SCRIPT = `
(() => {
  function getRole(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    switch (tag) {
      case 'button': return 'button';
      case 'a': return 'link';
      case 'input': {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'submit' || type === 'reset') return 'button';
        return 'textbox';
      }
      case 'select': return 'combobox';
      case 'textarea': return 'textbox';
      default: return 'generic';
    }
  }

  function getAccessibleName(el) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();
    const ariaLabelledBy = el.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      const labelEl = document.getElementById(ariaLabelledBy);
      if (labelEl) return labelEl.textContent.trim();
    }
    if (el.id) {
      const labels = document.querySelectorAll('label[for="' + el.id + '"]');
      if (labels.length > 0) return labels[0].textContent.trim();
    }
    const parentLabel = el.closest('label');
    if (parentLabel) {
      const clone = parentLabel.cloneNode(true);
      const inputs = clone.querySelectorAll('input, select, textarea');
      inputs.forEach(i => i.remove());
      const text = clone.textContent.trim();
      if (text) return text;
    }
    const tag = el.tagName.toLowerCase();
    if (tag === 'button' || tag === 'a') {
      return el.textContent.trim().substring(0, 100);
    }
    return '';
  }

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  const headings = [];
  document.querySelectorAll('${HEADING_TAGS}').forEach(h => {
    if (isVisible(h)) headings.push(h.textContent.trim().substring(0, 200));
  });

  const elements = [];
  document.querySelectorAll('${INTERACTIVE_SELECTORS}').forEach(el => {
    if (!isVisible(el)) return;
    const role = getRole(el);
    if (role === 'generic' && !el.getAttribute('tabindex')) return;

    const tag = el.tagName.toLowerCase();
    const inputType = tag === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : undefined;

    elements.push({
      tag,
      role,
      accessibleName: getAccessibleName(el) || undefined,
      label: undefined,
      placeholder: el.getAttribute('placeholder') || undefined,
      inputType,
      visibleText: el.textContent.trim().substring(0, 100) || undefined,
      enabled: !el.disabled,
      checked: !!el.checked,
      selected: !!el.selected,
      testId: el.getAttribute('data-testid') || undefined,
    });
  });

  return {
    url: window.location.href,
    title: document.title,
    headings,
    pageText: (document.body ? document.body.innerText : '').substring(0, 2000),
    elements: elements.slice(0, ${OBSERVATION_BUDGET}),
  };
})()
`;

export async function observeBrowser(page: BrowserPage): Promise<BrowserObservation> {
  const raw = await page.evaluate<RawObservationData>(OBSERVATION_SCRIPT);

  const elements: ObservedElement[] = raw.elements.map((el: RawObservationData['elements'][number], index: number) => {
    const id = `el-${String(index + 1).padStart(3, '0')}`;
    return {
      id,
      role: el.role ?? 'generic',
      visible: true,
      accessibleName: el.accessibleName,
      label: el.label,
      placeholder: el.placeholder,
      inputType: el.inputType,
      visibleText: el.visibleText,
      enabled: el.enabled,
      checked: el.checked || undefined,
      selected: el.selected || undefined,
    };
  });

  return {
    url: raw.url,
    title: raw.title,
    headings: raw.headings,
    pageText: raw.pageText ?? '',
    elements,
    truncated: raw.elements.length >= OBSERVATION_BUDGET,
  };
}

export function getObservationScript(): string {
  return OBSERVATION_SCRIPT;
}
