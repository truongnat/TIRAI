// ---------------------------------------------------------------------------
// Agentic Phase 2B — narrow safe preparation executor
// ---------------------------------------------------------------------------

import {
  DefaultAuditRecorder,
  InMemoryBindingStore,
  ValueGeneratorExecutor,
  defaultPolicy,
  type ExecutionContext,
  type PreparationOperation,
} from 'execution-engine';
import type { TestDataItem } from 'test-data-planner';
import type { RuntimeDataStore } from './runtime-data-store.js';

export class RuntimePreparationError extends Error {
  readonly dataItemId: string;

  constructor(dataItemId: string, message: string) {
    super(message);
    this.name = 'RuntimePreparationError';
    this.dataItemId = dataItemId;
  }
}

/**
 * Executes only the side-effect-free value-generator operation currently
 * supported by Phase 2B.2. DB/API operations stay behind explicit discovery
 * adapters and are never synthesized here.
 */
export class RuntimePreparationExecutor {
  private readonly valueGenerator = new ValueGeneratorExecutor();

  async generate(
    item: TestDataItem,
    operation: PreparationOperation,
    store: RuntimeDataStore,
    generationSeed: string,
  ): Promise<unknown> {
    const bindings = new InMemoryBindingStore();
    for (const binding of store.toBindingResults()) bindings.produce(binding);

    const policy = {
      ...defaultPolicy(),
      mode: 'simulate' as const,
      allowMutation: false,
      allowedExecutorTypes: ['value-generator' as const],
    };
    const context: ExecutionContext = {
      mode: 'simulate',
      policy,
      bindings,
      audit: new DefaultAuditRecorder('phase2b'),
      seed: generationSeed,
    };

    const result = await this.valueGenerator.execute(operation, context);
    const produced = result.producedBindings.find(
      (binding) => binding.name === `runtime.${item.id}`,
    );
    if (result.status !== 'succeeded' || !produced || produced.value === undefined) {
      throw new RuntimePreparationError(item.id, 'Safe value generation did not produce a runtime binding.');
    }
    return produced.value;
  }
}
