import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import {
  OutputProvider,
  CanonicalOutputPayload,
  OutputDeliveryContext,
  OutputDeliveryResult,
  LocalReportProviderConfig,
  DeliveryKeyId,
  PayloadFingerprint,
} from '../models.js';
import { computeOutputId } from '../fingerprint.js';

export class LocalReportProvider implements OutputProvider {
  readonly id = 'local-report';
  readonly displayName = 'Local Report Provider';

  private basePath: string;
  private format: 'markdown' | 'json';

  constructor(config: LocalReportProviderConfig) {
    this.basePath = config.basePath;
    this.format = config.format ?? 'markdown';
  }

  async deliver(
    payload: CanonicalOutputPayload,
    context: OutputDeliveryContext,
  ): Promise<OutputDeliveryResult> {
    if (context.dryRun) {
      return this.dryRunResult(payload, context);
    }

    const outputPath = this.computeOutputPath(context);
    const content = this.format === 'markdown'
      ? this.renderMarkdown(payload)
      : JSON.stringify(payload, null, 2);

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content, 'utf-8');

    const outputId = computeOutputId(payload.runId, context.target.path ?? 'default');

    return {
      success: true,
      status: 'DELIVERED',
      outputId,
      deliveryKey: context.target.path ?? 'default',
      payloadFingerprint: '',
      providerId: this.id,
      target: context.target,
      artifactPath: outputPath,
    };
  }

  private dryRunResult(
    payload: CanonicalOutputPayload,
    context: OutputDeliveryContext,
  ): OutputDeliveryResult {
    const outputPath = this.computeOutputPath(context);
    const outputId = computeOutputId(payload.runId, context.target.path ?? 'default');

    return {
      success: true,
      status: 'SKIPPED',
      outputId,
      deliveryKey: context.target.path ?? 'default',
      payloadFingerprint: '',
      providerId: this.id,
      target: context.target,
      artifactPath: outputPath,
    };
  }

  private computeOutputPath(context: OutputDeliveryContext): string {
    const filename = this.format === 'markdown' ? 'report.md' : 'report.json';
    const targetPath = context.target.path ?? 'default';
    return join(this.basePath, targetPath, filename);
  }

  private renderMarkdown(payload: CanonicalOutputPayload): string {
    const lines: string[] = [];

    lines.push('# TIRAI Test Execution Report');
    lines.push('');
    lines.push(`**Schema Version:** ${payload.schemaVersion}`);
    lines.push(`**Run ID:** ${payload.runId}`);
    lines.push(`**Projected At:** ${payload.timestamps.projectedAt}`);
    lines.push('');

    lines.push('## Source Revision');
    lines.push('');
    lines.push(`- **Source ID:** ${payload.sourceRevision.sourceId}`);
    lines.push(`- **Revision:** ${payload.sourceRevision.revision}`);
    if (payload.sourceRevision.contentHash) {
      lines.push(`- **Content Hash:** ${payload.sourceRevision.contentHash}`);
    }
    if (payload.sourceRevision.revisionFingerprint) {
      lines.push(`- **Revision Fingerprint:** ${payload.sourceRevision.revisionFingerprint}`);
    }
    lines.push('');

    if (payload.applicationRevision) {
      lines.push('## Application Revision');
      lines.push('');
      lines.push(`- **Name:** ${payload.applicationRevision.name}`);
      if (payload.applicationRevision.version) {
        lines.push(`- **Version:** ${payload.applicationRevision.version}`);
      }
      if (payload.applicationRevision.fingerprint) {
        lines.push(`- **Fingerprint:** ${payload.applicationRevision.fingerprint}`);
      }
      lines.push(`- **Tracked:** ${payload.applicationRevision.tracked ? 'Yes' : 'No'}`);
      lines.push('');
    }

    lines.push('## Verification Summary');
    lines.push('');
    lines.push(`| Metric | Count |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total Requirements | ${payload.verificationSummary.totalRequirements} |`);
    lines.push(`| Passed | ${payload.verificationSummary.passed} |`);
    lines.push(`| Failed | ${payload.verificationSummary.failed} |`);
    lines.push(`| Blocked | ${payload.verificationSummary.blocked} |`);
    lines.push(`| Error | ${payload.verificationSummary.error} |`);
    lines.push(`| Not Tested | ${payload.verificationSummary.notTested} |`);
    lines.push(`| Total Test Cases | ${payload.verificationSummary.totalTestCases} |`);
    lines.push(`| Test Cases Passed | ${payload.verificationSummary.testCasesPassed} |`);
    lines.push(`| Test Cases Failed | ${payload.verificationSummary.testCasesFailed} |`);
    lines.push(`| Test Cases Blocked | ${payload.verificationSummary.testCasesBlocked} |`);
    lines.push(`| Test Cases Skipped | ${payload.verificationSummary.testCasesSkipped} |`);
    lines.push('');

    lines.push('## Evidence Origin');
    lines.push('');
    lines.push(`- **Fresh Evidence:** ${payload.evidenceOrigin.freshEvidenceCount}`);
    lines.push(`- **Reused Evidence:** ${payload.evidenceOrigin.reusedEvidenceCount}`);
    lines.push(`- **Not Tracked:** ${payload.evidenceOrigin.notTrackedCount}`);
    lines.push('');

    if (payload.requirements.length > 0) {
      lines.push('## Requirements');
      lines.push('');
      for (const req of payload.requirements) {
        const statusIcon = this.getStatusIcon(req.status);
        lines.push(`### ${statusIcon} ${req.requirementId}`);
        lines.push('');
        lines.push(`- **Status:** ${req.status}`);
        lines.push(`- **Test Cases:** ${req.testCaseIds.join(', ') || 'None'}`);
        lines.push(`- **Evidence:** ${req.evidenceIds.join(', ') || 'None'}`);
        lines.push('');
      }
    }

    if (payload.testCases.length > 0) {
      lines.push('## Test Cases');
      lines.push('');
      for (const tc of payload.testCases) {
        const statusIcon = this.getStatusIcon(tc.status);
        const proofLabel = tc.proofOrigin === 'REUSED' ? ' (Reused)' : '';
        lines.push(`### ${statusIcon} ${tc.testCaseId}${proofLabel}`);
        lines.push('');
        lines.push(`- **Status:** ${tc.status}`);
        lines.push(`- **Proof Origin:** ${tc.proofOrigin}`);
        lines.push(`- **Requirements:** ${tc.requirementIds.join(', ') || 'None'}`);
        lines.push(`- **Evidence:** ${tc.evidenceIds.join(', ') || 'None'}`);
        lines.push('');
      }
    }

    if (payload.safeEvidenceReferences.length > 0) {
      lines.push('## Safe Evidence References');
      lines.push('');
      lines.push(`| Evidence ID | Type | Source | Safe Artifact Ref |`);
      lines.push(`|-------------|------|--------|-------------------|`);
      for (const ref of payload.safeEvidenceReferences) {
        lines.push(`| ${ref.evidenceId} | ${ref.type} | ${ref.sourceExecutor} | ${ref.safeArtifactRef ?? 'N/A'} |`);
      }
      lines.push('');
    }

    if (payload.traceSummary.nodes.length > 0) {
      lines.push('## Traceability');
      lines.push('');
      lines.push('### Trace Nodes');
      lines.push('');
      for (const node of payload.traceSummary.nodes) {
        lines.push(`- **${node.id}** (${node.kind}): ${node.ref}`);
      }
      lines.push('');

      if (payload.traceSummary.edges.length > 0) {
        lines.push('### Trace Edges');
        lines.push('');
        for (const edge of payload.traceSummary.edges) {
          lines.push(`- ${edge.from} → ${edge.to} (${edge.relation})`);
        }
        lines.push('');
      }
    }

    if (payload.warnings.length > 0) {
      lines.push('## Warnings');
      lines.push('');
      for (const warning of payload.warnings) {
        lines.push(`- ⚠️ ${warning}`);
      }
      lines.push('');
    }

    if (payload.errors.length > 0) {
      lines.push('## Errors');
      lines.push('');
      for (const error of payload.errors) {
        lines.push(`- ❌ ${error}`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('');
    lines.push('*Generated by TIRAI Output Provider Framework*');

    return lines.join('\n');
  }

  private getStatusIcon(status: string): string {
    switch (status) {
      case 'PASS':
      case 'PASSED':
        return '✅';
      case 'FAIL':
      case 'FAILED':
        return '❌';
      case 'BLOCKED':
        return '🚫';
      case 'ERROR':
        return '⚠️';
      case 'SKIPPED':
        return '⏭️';
      case 'MANUAL':
        return '👤';
      default:
        return '❓';
    }
  }
}
