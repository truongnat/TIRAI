import type {
  CanonicalSourceDocument,
  LocalSourceInput,
  SourceConnector,
} from './models.js';

export class SourceIngestionError extends Error {
  readonly code: 'UNSUPPORTED_SOURCE' | 'INVALID_SOURCE' | 'SOURCE_REVISION_MISMATCH';

  constructor(code: SourceIngestionError['code'], message: string) {
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
    const candidates = this.connectors.filter((connector) => connector.canOpen(input));
    if (candidates.length !== 1) {
      throw new SourceIngestionError(
        'UNSUPPORTED_SOURCE',
        candidates.length === 0
          ? `No source connector supports "${input.kind ?? input.path}".`
          : `Multiple source connectors support "${input.kind ?? input.path}".`,
      );
    }
    return candidates[0]!;
  }

  async open(input: LocalSourceInput): Promise<CanonicalSourceDocument> {
    return this.resolve(input).open(input);
  }
}
