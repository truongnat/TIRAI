// Persistence (spec §23, §24).
//
// Canonical result is the source of truth; run-result-ir.json is its
// serialization and summary.md is a secondary human view derived FROM it.
// summary.md is never the source of the result JSON (spec §24).

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { TestRunResultIR } from './re-export.js';

export function writeRunResultJson(path: string, result: TestRunResultIR): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(result, null, 2), 'utf8');
}

export interface SummaryContext {
  framework: 'playwright';
  executionMode: 'GENERATED_E2E';
  generationStatus: string;
  testCasesReceived: number;
  testCasesGenerated: number;
  testCasesBlocked: number;
  generatedFiles: string[];
  metricsNote?: string;
}

export function writeSummary(
  path: string,
  result: TestRunResultIR,
  ctx: SummaryContext,
): void {
  mkdirSync(dirname(path), { recursive: true });
  const s = result.summary;
  const lines: string[] = [];
  lines.push('# TIRAI Phase 5.1 — Generated Test Run Summary');
  lines.push('');
  lines.push(`- Execution mode: \`${ctx.executionMode}\``);
  lines.push(`- Framework: \`${ctx.framework}\``);
  lines.push(`- Canonical run status: \`${result.status}\``);
  lines.push(`- Run id: \`${result.runId}\``);
  lines.push(`- Started: ${result.startedAt}`);
  lines.push(`- Finished: ${result.finishedAt}`);
  lines.push(`- Duration (ms): ${s.durationMs}`);

  lines.push('## Generation');
  lines.push(`- Test cases received: ${ctx.testCasesReceived}`);
  lines.push(`- Test cases generated: ${ctx.testCasesGenerated}`);
  lines.push(`- Test cases blocked: ${ctx.testCasesBlocked}`);
  lines.push(`- Generated files: ${ctx.generatedFiles.length}`);
  for (const f of ctx.generatedFiles) lines.push(`  - ${f}`);

  lines.push('## Execution');
  lines.push(`- testsTotal: ${s.testsTotal}`);
  lines.push(`- passed: ${s.passed}`);
  lines.push(`- failed: ${s.failed}`);
  lines.push(`- errors: ${s.errors}`);
  lines.push(`- blocked: ${s.blocked}`);
  lines.push(`- skipped: ${s.skipped}`);

  lines.push('## Per-test results');
  for (const t of result.testResults) {
    const err = t.errors[0]?.message ?? '';
    lines.push(`- \`${t.testCaseId}\` → **${t.status}**${err ? ` — ${err.split('\n')[0]}` : ''}`);
  }

  lines.push('');
  lines.push('> Generated from canonical TestRunResultIR. Not the source of truth.');
  writeFileSync(path, lines.join('\n'), 'utf8');
}

/** Count occurrences of a sentinel across arbitrary text blobs (spec §35). */
export function countSecretLeaks(contents: string[], sentinel: string): number {
  if (!sentinel) return 0;
  let count = 0;
  for (const c of contents) {
    let idx = c.indexOf(sentinel);
    while (idx >= 0) {
      count++;
      idx = c.indexOf(sentinel, idx + sentinel.length);
    }
  }
  return count;
}
