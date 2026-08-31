export type {
  CanonicalContextChunk,
  CanonicalContextProvenance,
  CanonicalContextRelation,
  CanonicalSourceDocument,
  LocalSourceInput,
  SanitizedMetadataValue,
  SourceArtifact,
  SourceConnector,
  SourceDescriptor,
  SourceLocation,
  SourceLocationSegment,
  SourceRevision,
} from './models.js';
export { SourceConnectorRegistry, SourceIngestionError } from './registry.js';
export { sanitizeMetadata, assertNoRawCredentialMetadata } from './sanitizer.js';
export { sha256, stableId, locationKey } from './ids.js';
export { ExcelSourceConnector, EXCEL_CONNECTOR_ID, EXCEL_CONNECTOR_VERSION } from './excel-connector.js';
export { MarkdownSourceConnector, MARKDOWN_CONNECTOR_ID, MARKDOWN_CONNECTOR_VERSION } from './markdown-connector.js';
export { PdfSourceConnector, PDF_CONNECTOR_ID, PDF_CONNECTOR_VERSION } from './pdf-connector.js';
export { DocxSourceConnector, DOCX_CONNECTOR_ID, DOCX_CONNECTOR_VERSION } from './docx-connector.js';
export { CsvSourceConnector, CSV_CONNECTOR_ID, CSV_CONNECTOR_VERSION } from './csv-connector.js';

import { ExcelSourceConnector } from './excel-connector.js';
import { MarkdownSourceConnector } from './markdown-connector.js';
import { PdfSourceConnector } from './pdf-connector.js';
import { DocxSourceConnector } from './docx-connector.js';
import { CsvSourceConnector } from './csv-connector.js';
import { SourceConnectorRegistry } from './registry.js';

export function createDefaultSourceConnectorRegistry(): SourceConnectorRegistry {
  return new SourceConnectorRegistry([
    new ExcelSourceConnector(),
    new MarkdownSourceConnector(),
    new PdfSourceConnector(),
    new DocxSourceConnector(),
    new CsvSourceConnector(),
  ]);
}
