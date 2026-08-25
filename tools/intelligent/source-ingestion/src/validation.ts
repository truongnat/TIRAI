import type { CanonicalSourceDocument } from './models.js';
import { sha256 } from './ids.js';
import { SourceIngestionError } from './registry.js';

export function assertCanonicalSourceDocument(document: CanonicalSourceDocument): void {
  const artifactIds = new Set(document.artifacts.map((artifact) => artifact.id));
  for (const artifact of document.artifacts) {
    if (artifact.sourceId !== document.source.id || artifact.revisionId !== document.revision.id) {
      throw new SourceIngestionError(
        'SOURCE_REVISION_MISMATCH',
        `Artifact '${artifact.id}' does not belong to source revision '${document.revision.id}'.`,
      );
    }
    if (artifact.parentArtifactId && !artifactIds.has(artifact.parentArtifactId)) {
      throw new SourceIngestionError(
        'INVALID_SOURCE',
        `Artifact '${artifact.id}' references missing parent '${artifact.parentArtifactId}'.`,
      );
    }
  }
  for (const context of document.contexts) {
    const provenance = context.provenance;
    if (
      provenance.sourceId !== document.source.id ||
      provenance.revisionId !== document.revision.id ||
      !artifactIds.has(provenance.artifactId)
    ) {
      throw new SourceIngestionError(
        'SOURCE_REVISION_MISMATCH',
        `Context '${context.id}' is stale or belongs to a different source revision.`,
      );
    }
    if (context.contentHash !== sha256(context.content)) {
      throw new SourceIngestionError(
        'INVALID_SOURCE',
        `Context '${context.id}' content hash does not match its content.`,
      );
    }
  }
}
