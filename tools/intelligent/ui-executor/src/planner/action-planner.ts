// UI Executor v1 — Action planner.
//
// Compiles TestExecutionMapping step mappings into executable UIActionPlans.
// Resolves value expressions (literal, binding, secret) and validates action
// targets against the element catalog.

import type {
  UIStepMapping,
  UIActionPlan,
  UIActionType,
  UIValueExpression,
  UIElementTarget,
  TestExecutionMapping,
  RuntimeBindingStore,
  SecretProvider,
} from '../models.js';
import type { LocatorResolver } from '../catalog/index.js';
import { UIExecutorError } from '../errors.js';

export class ActionPlanner {
  private resolver: LocatorResolver;

  constructor(resolver: LocatorResolver) {
    this.resolver = resolver;
  }

  // Compile all step mappings into action plans for a test case
  async compileActions(
    mapping: TestExecutionMapping,
    bindings: RuntimeBindingStore,
    secrets: SecretProvider,
  ): Promise<UIActionPlan[]> {
    const plans: UIActionPlan[] = [];

    for (const sm of mapping.stepMappings) {
      const plan = await this.compileStep(sm, bindings, secrets);
      plans.push(plan);
    }

    return plans;
  }

  // Compile a single step mapping into an action plan
  async compileStep(
    sm: UIStepMapping,
    bindings: RuntimeBindingStore,
    secrets: SecretProvider,
  ): Promise<UIActionPlan> {
    const action = sm.action as UIActionType;

    // Build target if step has a logical name
    let target: UIElementTarget | undefined;
    if (sm.targetLogicalName) {
      target = { logicalName: sm.targetLogicalName };
      // Validate that the target exists in catalog
      this.resolver.resolve(target);
    }

    // Build value expression
    let value: UIValueExpression | undefined;
    if (sm.valueLiteral !== undefined) {
      value = { kind: 'literal', value: sm.valueLiteral };
    } else if (sm.valueBinding !== undefined) {
      const resolved = bindings.resolve(sm.valueBinding);
      if (!resolved || resolved.status !== 'resolved') {
        throw new UIExecutorError(
          'UI_BINDING_MISSING',
          `Binding '${sm.valueBinding}' is not resolved (status: ${resolved?.status ?? 'missing'}).`,
          { bindingName: sm.valueBinding },
        );
      }
      value = { kind: 'binding', bindingName: sm.valueBinding };
    } else if (sm.secretRef !== undefined) {
      const secretValue = await secrets.resolve(sm.secretRef);
      if (secretValue === undefined || secretValue === null) {
        throw new UIExecutorError(
          'UI_SECRET_RESOLUTION_FAILED',
          `Secret '${sm.secretRef}' could not be resolved.`,
          { secretRef: sm.secretRef },
        );
      }
      value = { kind: 'secret', secretRef: sm.secretRef };
    }

    return {
      stepOrder: sm.stepOrder,
      action,
      target,
      value,
      timeoutMs: sm.timeoutMs,
    };
  }

  // Resolve a value expression to a concrete string
  static async resolveValue(
    value: UIValueExpression | undefined,
    bindings: RuntimeBindingStore,
    secrets: SecretProvider,
  ): Promise<string | undefined> {
    if (!value) return undefined;
    switch (value.kind) {
      case 'literal':
        return value.value;
      case 'binding': {
        const result = bindings.resolve(value.bindingName);
        return result?.value !== undefined ? String(result.value) : undefined;
      }
      case 'secret': {
        const s = await secrets.resolve(value.secretRef);
        return s?.value ?? undefined;
      }
    }
  }
}
