// ---------------------------------------------------------------------------
// Agentic Test Executor — data resolver
// ---------------------------------------------------------------------------

import type { TestDataItem } from 'test-data-planner';

export interface DataResolutionContext {
  secrets?: Record<string, string>;
  bindings?: Map<string, string>;
  inputs?: Array<{ name: string; value?: string; valueStrategy?: string }>;
}

export interface DataResolutionResult {
  dataItemId: string;
  resolved: boolean;
  value?: string;
  secretRef?: string;
  unresolvedReason?: string;
}

export function resolveDataItem(
  item: TestDataItem,
  context: DataResolutionContext,
): DataResolutionResult {
  const inputMatch = context.inputs?.find(
    (inp) => inp.name === item.name || inp.name === item.id,
  );

  if (inputMatch?.value) {
    if (inputMatch.value.startsWith('secret://')) {
      const secretKey = inputMatch.value.replace('secret://', '');
      const secretValue = context.secrets?.[secretKey];
      if (secretValue) {
        return { dataItemId: item.id, resolved: true, value: secretValue, secretRef: secretKey };
      }
      return { dataItemId: item.id, resolved: false, unresolvedReason: `Secret not found: ${secretKey}` };
    }
    return { dataItemId: item.id, resolved: true, value: inputMatch.value };
  }

  const bindingValue = context.bindings?.get(item.id) ?? context.bindings?.get(item.name);
  if (bindingValue) {
    return { dataItemId: item.id, resolved: true, value: bindingValue };
  }

  if (item.type === 'account' || item.strategy === 'reuse-existing') {
    const generated = generateDeterministicValue(item);
    if (generated) {
      return { dataItemId: item.id, resolved: true, value: generated };
    }
  }

  return {
    dataItemId: item.id,
    resolved: false,
    unresolvedReason: `No resolution path for data item ${item.id} (${item.type})`,
  };
}

function generateDeterministicValue(item: TestDataItem): string | null {
  const desc = item.description.toLowerCase();
  if (desc.includes('email')) return `test-${item.id}@example.com`;
  if (desc.includes('username') || desc.includes('user')) return `user_${item.id}`;
  if (desc.includes('password')) return `TestPass123!`;
  if (desc.includes('name')) return `Test ${item.id}`;
  return null;
}
