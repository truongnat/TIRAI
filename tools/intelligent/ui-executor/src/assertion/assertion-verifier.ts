// UI Executor v1 — Assertion verifier.
//
// Verifies UI assertion plans against the current browser page state. Supports
// all 16 assertion types. Returns structured UIAssertionResult.

import type {
  UIAssertionPlan,
  UIAssertionResult,
  BrowserPage,
} from '../models.js';
import type { LocatorResolver } from '../catalog/index.js';
import { UIExecutorError } from '../errors.js';

export class AssertionVerifier {
  private resolver: LocatorResolver;

  constructor(resolver: LocatorResolver) {
    this.resolver = resolver;
  }

  // Verify a single assertion plan against the browser page
  async verify(plan: UIAssertionPlan, page: BrowserPage): Promise<UIAssertionResult> {
    try {
      const result = await this.evaluate(plan, page);
      return { plan, status: result.passed ? 'passed' : 'failed', actual: result.actual };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { plan, status: 'blocked', error: message };
    }
  }

  // Verify multiple assertion plans
  async verifyAll(plans: UIAssertionPlan[], page: BrowserPage): Promise<UIAssertionResult[]> {
    const results: UIAssertionResult[] = [];
    for (const plan of plans) {
      results.push(await this.verify(plan, page));
    }
    return results;
  }

  private async evaluate(
    plan: UIAssertionPlan,
    page: BrowserPage,
  ): Promise<{ passed: boolean; actual?: string }> {
    const type = plan.assertionType;

    // Page-level assertions (no target needed)
    if (type === 'url-equals') {
      const actual = page.url();
      return { passed: actual === plan.expectedValue, actual };
    }
    if (type === 'url-contains') {
      const actual = page.url();
      return { passed: actual.includes(plan.expectedValue ?? ''), actual };
    }
    if (type === 'page-title') {
      const actual = await page.title();
      return { passed: actual === plan.expectedValue, actual };
    }

    // Target-required assertions
    if (!plan.target) {
      throw new UIExecutorError(
        'UI_ASSERTION_UNVERIFIABLE',
        `Assertion type '${type}' requires a target.`,
        { assertionType: type },
      );
    }

    const locator = this.resolver.resolve(plan.target);

    switch (type) {
      case 'visible': {
        const actual = await page.isVisible(locator);
        return { passed: actual === true, actual: String(actual) };
      }
      case 'hidden': {
        const actual = await page.isVisible(locator);
        return { passed: actual === false, actual: String(actual) };
      }
      case 'enabled': {
        const actual = await page.isEnabled(locator);
        return { passed: actual === true, actual: String(actual) };
      }
      case 'disabled': {
        const actual = await page.isEnabled(locator);
        return { passed: actual === false, actual: String(actual) };
      }
      case 'checked': {
        const actual = await page.isChecked(locator);
        return { passed: actual === true, actual: String(actual) };
      }
      case 'unchecked': {
        const actual = await page.isChecked(locator);
        return { passed: actual === false, actual: String(actual) };
      }
      case 'text-equals': {
        const actual = await page.textContent(locator);
        return { passed: actual === plan.expectedValue, actual };
      }
      case 'text-contains': {
        const actual = await page.textContent(locator);
        return { passed: actual.includes(plan.expectedValue ?? ''), actual };
      }
      case 'value-equals': {
        const actual = await page.inputValue(locator);
        return { passed: actual === plan.expectedValue, actual };
      }
      case 'element-count': {
        const actual = await page.count(locator);
        const expected = parseInt(plan.expectedValue ?? '0', 10);
        return { passed: actual === expected, actual: String(actual) };
      }
      case 'attribute-equals': {
        // expectedValue format: "attrName=expectedAttrValue"
        const eqIdx = plan.expectedValue?.indexOf('=') ?? -1;
        if (eqIdx < 0) {
          throw new UIExecutorError(
            'UI_ASSERTION_UNVERIFIABLE',
            `attribute-equals expectedValue must be 'attrName=attrValue', got '${plan.expectedValue}'.`,
            { expectedValue: plan.expectedValue },
          );
        }
        const attrName = plan.expectedValue!.slice(0, eqIdx);
        const attrExpected = plan.expectedValue!.slice(eqIdx + 1);
        const actual = await page.attribute(locator, attrName);
        return { passed: actual === attrExpected, actual: actual ?? 'null' };
      }
      case 'exists': {
        const actual = await page.count(locator);
        return { passed: actual > 0, actual: String(actual) };
      }
      case 'not-exists': {
        const actual = await page.count(locator);
        return { passed: actual === 0, actual: String(actual) };
      }
      default:
        throw new UIExecutorError(
          'UI_ACTION_UNSUPPORTED',
          `Unsupported assertion type: '${type as string}'.`,
          { assertionType: type },
        );
    }
  }
}
