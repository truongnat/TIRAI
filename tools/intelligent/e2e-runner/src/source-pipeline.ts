import type { AIProvider } from 'ai-provider';
import { analyzeCanonicalContext } from 'semantic-analyzer';
import {
  assertCanonicalSourceDocument,
  createDefaultSourceConnectorRegistry,
  type CanonicalSourceDocument,
  type LocalSourceInput,
  type SourceConnectorRegistry,
} from 'source-ingestion';

import {
  Scenario3Pipeline,
  type Scenario3Dependencies,
  type Scenario3Input,
  type Scenario3Result,
} from './scenario3.js';

export interface SourceScenario3Dependencies extends Scenario3Dependencies {
  connectorRegistry?: SourceConnectorRegistry;
  semanticAnalyzerOptions?: Parameters<typeof analyzeCanonicalContext>[2];
}

export interface SourceScenario3Result {
  sourceDocument: CanonicalSourceDocument;
  semanticIR: Awaited<ReturnType<typeof analyzeCanonicalContext>>;
  scenario3: Scenario3Result;
}

/** Compose a source connector with the existing, source-agnostic Scenario 3 pipeline. */
export async function runScenario3FromSource(
  input: LocalSourceInput,
  dependencies: SourceScenario3Dependencies,
  scenarioInput?: Omit<Scenario3Input, 'semanticIR'>,
): Promise<SourceScenario3Result> {
  const registry = dependencies.connectorRegistry ?? createDefaultSourceConnectorRegistry();
  const sourceDocument = await registry.open(input);
  assertCanonicalSourceDocument(sourceDocument);
  const semanticIR = await analyzeCanonicalContext(
    sourceDocument,
    dependencies.aiProvider,
    dependencies.semanticAnalyzerOptions,
  );
  const scenario3 = await new Scenario3Pipeline(dependencies).run({
    ...(scenarioInput ?? {}),
    semanticIR,
  });
  return { sourceDocument, semanticIR, scenario3 };
}

export type { AIProvider };
