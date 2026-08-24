// ---------------------------------------------------------------------------
// Agentic Test Executor — runtime data resolution
//
// This is deliberately a runtime binding resolver, not a replacement for the
// frozen tools/intelligent/data-resolver planning package. It may consume
// supplied values and existing bindings, and it may generate only data whose
// semantics explicitly allow synthesis. It never fabricates existing data.
// ---------------------------------------------------------------------------

import type { TestDataItem } from 'test-data-planner';
import type {
  DataNeedSemantics,
  DataNeedStatus,
  DataResolutionResult,
} from '../models.js';

export interface DataResolutionContext {
  secrets?: Record<string, string>;
  bindings?: Map<string, string>;
  inputs?: Array<{ name: string; value?: string; valueStrategy?: string }>;
  secretResolver?: (secretRef: string) => Promise<string | undefined>;
}

export interface DataResolutionExecutionContext extends DataResolutionContext {
  secretResolver?: (secretRef: string) => Promise<string | undefined>;
}

export { DataResolutionResult };

/**
 * Resolve all Phase 1 items before browser execution. Secret references are
 * resolved only in process and are never included in the safe result view.
 */
export async function resolveDataItems(
  items: TestDataItem[],
  context: DataResolutionExecutionContext,
): Promise<DataResolutionResult[]> {
  const results: DataResolutionResult[] = [];

  for (const item of items) {
    const input = context.inputs?.find(
      (candidate) => candidate.name === item.name || candidate.name === item.id,
    );

    if (input?.value?.startsWith('secret://')) {
      const secretRef = input.value.slice('secret://'.length);
      let secretValue = context.secrets?.[secretRef];
      if (secretValue === undefined && context.secretResolver) {
        try {
          secretValue = await context.secretResolver(secretRef);
        } catch {
          secretValue = undefined;
        }
      }

      results.push(resolveDataItem(item, {
        ...context,
        secrets: secretValue === undefined
          ? context.secrets
          : { ...context.secrets, [secretRef]: secretValue },
      }));
      continue;
    }

    results.push(resolveDataItem(item, context));
  }

  return results;
}

export function classifyDataNeed(item: TestDataItem): DataNeedSemantics {
  const description = [
    item.name,
    item.description,
    ...item.constraints.map((constraint) => constraint.description),
  ].join(' ').toLowerCase();

  // Explicit existing-data intent always wins over a generator-looking name.
  if (
    item.strategy === 'reuse-existing' ||
    item.strategy === 'select-existing' ||
    item.lifecycle === 'existing' ||
    /\b(existing|pre[- ]existing|must exist|reuse|select existing)\b/.test(description) ||
    /\bvalid (account|user(name)?|customer|order|record)\b/.test(description) ||
    /\bapproved (state|record)\b/.test(description)
  ) {
    return 'EXISTENCE_REQUIRED';
  }

  return 'SYNTHETIC_ALLOWED';
}

export function resolveDataItem(
  item: TestDataItem,
  context: DataResolutionContext,
): DataResolutionResult {
  const semantics = classifyDataNeed(item);
  const inputMatch = context.inputs?.find(
    (input) => input.name === item.name || input.name === item.id,
  );

  if (inputMatch?.value !== undefined) {
    if (inputMatch.value.startsWith('secret://')) {
      const secretRef = inputMatch.value.slice('secret://'.length);
      const secretValue = context.secrets?.[secretRef];
      if (secretValue !== undefined) {
        return resolvedResult(item, semantics, 'secret', secretValue, {
          secretRef,
          sensitive: true,
          evidence: [`secret-ref:${secretRef}`],
        });
      }
      return unresolvedResult(
        item,
        semantics,
        'NEEDS_CAPABILITY',
        'Secret reference could not be resolved by the supplied secret capability.',
        'secret',
        { secretRef, sensitive: true },
      );
    }

    return resolvedResult(item, semantics, 'supplied-input', inputMatch.value, {
      evidence: [`supplied-input:${item.name}`],
    });
  }

  const bindingKey = item.id;
  const bindingValue = context.bindings?.get(bindingKey) ?? context.bindings?.get(item.name);
  if (bindingValue !== undefined) {
    return resolvedResult(item, semantics, 'runtime-binding', bindingValue, {
      bindingRef: context.bindings?.has(bindingKey) ? bindingKey : item.name,
      evidence: [`runtime-binding:${context.bindings?.has(bindingKey) ? bindingKey : item.name}`],
    });
  }

  if (semantics === 'EXISTENCE_REQUIRED') {
    return unresolvedResult(
      item,
      semantics,
      'NEEDS_CAPABILITY',
      'Existing data requires a supplied value, existing binding, or discovery capability; no value was invented.',
    );
  }

  const generated = generateDeterministicValue(item);
  if (generated !== null) {
    return resolvedResult(item, semantics, 'generator', generated, {
      status: 'GENERATED',
      evidence: [`generator:deterministic:${item.id}`],
    });
  }

  return unresolvedResult(
    item,
    semantics,
    'BLOCKED',
    `No safe synthetic generation path for data item ${item.id} (${item.type}).`,
  );
}

function resolvedResult(
  item: TestDataItem,
  semantics: DataNeedSemantics,
  source: DataResolutionResult['source'],
  value: string,
  options: {
    status?: Extract<DataNeedStatus, 'RESOLVED' | 'GENERATED' | 'DISCOVERED'>;
    bindingRef?: string;
    secretRef?: string;
    sensitive?: boolean;
    evidence?: string[];
  } = {},
): DataResolutionResult {
  return {
    dataItemId: item.id,
    status: options.status ?? 'RESOLVED',
    semantics,
    source,
    bindingRef: options.bindingRef,
    sensitive: options.sensitive ?? isSensitiveDataItem(item),
    evidence: options.evidence ?? [],
    value,
    secretRef: options.secretRef,
    resolved: true,
  };
}

function unresolvedResult(
  item: TestDataItem,
  semantics: DataNeedSemantics,
  status: Extract<DataNeedStatus, 'NEEDS_CAPABILITY' | 'BLOCKED'>,
  reason: string,
  source?: DataResolutionResult['source'],
  options: { secretRef?: string; sensitive?: boolean } = {},
): DataResolutionResult {
  return {
    dataItemId: item.id,
    status,
    semantics,
    source,
    sensitive: options.sensitive ?? isSensitiveDataItem(item),
    evidence: [],
    secretRef: options.secretRef,
    resolved: false,
    reason,
    unresolvedReason: reason,
  };
}

export function isSensitiveDataItem(item: TestDataItem): boolean {
  return /\b(password|passcode|secret|token|credential|api key)\b/i.test(
    `${item.name} ${item.description}`,
  );
}

function generateDeterministicValue(item: TestDataItem): string | null {
  const description = `${item.name} ${item.description}`.toLowerCase();
  if (description.includes('email')) return `test-${item.id}@example.com`;
  if (description.includes('username') || description.includes('user')) return `user_${item.id}`;
  if (description.includes('password')) return `TestPass123!`;
  if (description.includes('name')) return `Test ${item.id}`;
  return null;
}
