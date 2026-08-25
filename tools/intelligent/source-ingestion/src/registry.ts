import { extname } from 'node:path';

import type { LocalSourceInput, SourceConnector, SourceKind } from './models.js';

export type SourceIngestionErrorCode =
  'UNSUPPORTED_SOURCE' | 'INVALID_SOURCE' | 'SOURCE_REVISION_MISMATCH';

export class SourceIngestionError extends Error {
  readonly code: SourceIngestionErrorCode;

  constructor(code: SourceIngestionErrorCode, message: string) {
    super(message);
    this.name = 'SourceIngestionError';
    this.code = code;
  }
}

export class SourceConnectorRegistry {
  private readonly connectors: SourceConnector[];

  constructor(connectors: SourceConnector[]) {
    this.connectors = [...connectors];
  }

  resolve(input: LocalSourceInput): SourceConnector {
    const requestedKind = input.kind ?? kindFromExtension(input.path);
    const matches = this.connectors.filter(
      (connector) =>
        connector.kind === requestedKind && connector.canOpen({ ...input, kind: requestedKind }),
    );
    if (matches.length !== 1) {
      throw new SourceIngestionError(
        'UNSUPPORTED_SOURCE',
        `No deterministic connector is registered for source kind '${requestedKind}'.`,
      );
    }
    return matches[0];
  }

  async open(input: LocalSourceInput) {
    return this.resolve(input).open(input);
  }
}

function kindFromExtension(path: string): SourceKind {
  const extension = extname(path).toLowerCase();
  if (extension === '.xlsx' || extension === '.xlsm') return 'excel';
  if (extension === '.md' || extension === '.markdown') return 'markdown';
  throw new SourceIngestionError(
    'UNSUPPORTED_SOURCE',
    `Unsupported source extension '${extension || '(none)'}'.`,
  );
}
