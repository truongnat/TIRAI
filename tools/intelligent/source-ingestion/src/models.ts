export type SourceKind = 'excel' | 'markdown';

export interface SourceDescriptor {
  id: string;
  kind: SourceKind;
  displayName: string;
  connectorId: string;
  connectorVersion: string;
}

export interface SourceRevision {
  id: string;
  contentHash: string;
  version?: string;
}

export interface SourceLocationSegment {
  kind: string;
  value: string | number;
}

export interface SourceLocation {
  segments: SourceLocationSegment[];
}

export type SanitizedMetadataValue = string | number | boolean;

export interface SourceArtifact {
  id: string;
  sourceId: string;
  revisionId: string;
  parentArtifactId?: string;
  kind: string;
  location: SourceLocation;
  mediaType: string;
  content: string;
  contentHash: string;
  metadata: Record<string, SanitizedMetadataValue>;
}

export interface CanonicalContextProvenance {
  sourceId: string;
  revisionId: string;
  artifactId: string;
  location: SourceLocation;
}

export interface CanonicalContextRelation {
  type: 'previous' | 'next' | 'parent' | 'reference';
  targetContextId: string;
}

export interface CanonicalContextChunk {
  schemaVersion: '1.0';
  id: string;
  type: string;
  content: string;
  contentHash: string;
  provenance: CanonicalContextProvenance;
  parentContextId?: string;
  relations: CanonicalContextRelation[];
  metadata: Record<string, SanitizedMetadataValue>;
}

export interface CanonicalSourceDocument {
  schemaVersion: '1.0';
  source: SourceDescriptor;
  revision: SourceRevision;
  artifacts: SourceArtifact[];
  contexts: CanonicalContextChunk[];
}

export interface LocalSourceInput {
  path: string;
  kind?: SourceKind;
}

export interface SourceConnector {
  readonly id: string;
  readonly version: string;
  readonly kind: SourceKind;
  canOpen(input: LocalSourceInput): boolean;
  open(input: LocalSourceInput): Promise<CanonicalSourceDocument>;
}
