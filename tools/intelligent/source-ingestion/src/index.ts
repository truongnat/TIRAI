export * from './models.js';
export * from './ids.js';
export * from './sanitizer.js';
export * from './registry.js';
export * from './validation.js';
export * from './excel-connector.js';
export * from './markdown-connector.js';

import { ExcelSourceConnector } from './excel-connector.js';
import { MarkdownSourceConnector } from './markdown-connector.js';
import { SourceConnectorRegistry } from './registry.js';

export function createDefaultSourceConnectorRegistry(): SourceConnectorRegistry {
  return new SourceConnectorRegistry([new ExcelSourceConnector(), new MarkdownSourceConnector()]);
}
