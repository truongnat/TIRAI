import { createHash } from 'node:crypto';
import {
  DeliveryKeyId,
  PayloadFingerprint,
  DeliveryKeyComponents,
  CanonicalOutputPayload,
} from './models.js';

export function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export function computeDeliveryKey(components: DeliveryKeyComponents): DeliveryKeyId {
  const parts = [
    components.providerId,
    components.targetIdentity,
    components.runId,
  ];
  return sha256(parts.join('::'));
}

export function computePayloadFingerprint(payload: CanonicalOutputPayload): PayloadFingerprint {
  const normalized = normalizePayloadForFingerprint(payload);
  return sha256(JSON.stringify(normalized));
}

function normalizePayloadForFingerprint(payload: CanonicalOutputPayload): unknown {
  return {
    schemaVersion: payload.schemaVersion,
    runId: payload.runId,
    sourceRevision: {
      sourceId: payload.sourceRevision.sourceId,
      revision: payload.sourceRevision.revision,
      contentHash: payload.sourceRevision.contentHash,
      revisionFingerprint: payload.sourceRevision.revisionFingerprint,
    },
    requirements: payload.requirements
      .map((r) => ({
        requirementId: r.requirementId,
        status: r.status,
        testCaseIds: [...r.testCaseIds].sort(),
        evidenceIds: [...r.evidenceIds].sort(),
      }))
      .sort((a, b) => a.requirementId.localeCompare(b.requirementId)),
    testCases: payload.testCases
      .map((tc) => ({
        testCaseId: tc.testCaseId,
        requirementIds: [...tc.requirementIds].sort(),
        status: tc.status,
        proofOrigin: tc.proofOrigin,
        evidenceIds: [...tc.evidenceIds].sort(),
      }))
      .sort((a, b) => a.testCaseId.localeCompare(b.testCaseId)),
    verificationSummary: payload.verificationSummary,
    evidenceOrigin: payload.evidenceOrigin,
  };
}

export function computeOutputId(runId: string, deliveryKey: DeliveryKeyId): string {
  return sha256(`${runId}::${deliveryKey}::${Date.now()}`);
}
